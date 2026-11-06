"""飲食店検索 API。

起動:
    cd backend
    python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
    export YELP_API_KEY=xxxxx   # 未設定ならモックデータを返す
    .venv/bin/uvicorn main:app --reload --port 8000

エンドポイント:
    GET /api/shops?prefecture=東京都&area=渋谷&genre=寿司&genre=カフェ&min_rating=3.5&max_rating=4.5&budget_min=1000&budget_max=8000
    GET /api/shops?lat=35.66&lng=139.70&radius=3000   # 現在地から radius（m）以内
    GET /api/shops/route?olat=35.68&olng=139.77&dlat=35.66&dlng=139.70&buffer=500  # ルートから buffer（m）以内
    GET /api/geocode?q=東京駅                           # 地名 → 座標の候補
    GET /api/shops/lookup?id=xxx&id=yyy                 # 店舗 ID から最新の店舗情報（お気に入り用）

/api/shops と /api/shops/route は parking=true（駐車場あり）・groups=true（大人数OK）でも絞り込める。
"""

# 複数の Yelp 検索を並行実行するための asyncio
import asyncio
# 切り上げ計算に使う math
import math
# 環境変数を読むための os
import os
# 店舗 ID の形式チェックに使う正規表現
import re
# キャッシュの経過時間を測るための time
import time
# 固定値の型（Literal）と「値または None」の型（Optional）
from typing import Literal, Optional

# FastAPI 本体・HTTP エラー・クエリパラメータ定義
from fastapi import FastAPI, HTTPException, Query
# CORS（別オリジンからのアクセス許可）のミドルウェア
from fastapi.middleware.cors import CORSMiddleware
# リダイレクト応答
from fastapi.responses import RedirectResponse
# レスポンスの型を定義する Pydantic の基底クラス
from pydantic import BaseModel

# ルート検索・地名検索・距離計算
import routing
# Yelp API クライアント
import yelp
# モック店舗データと、絞り込み・ジャンル集計・距離付与の関数
from shops import SHOPS, SHOPS_BY_ID, filter_shops, genre_facets, with_distance

# ルート検索で Yelp を呼ぶ地点数の上限（API の呼び出し回数を抑える）
ROUTE_MAX_SAMPLES = 10
# ルート検索で同時に実行する Yelp リクエスト数の上限
ROUTE_YELP_CONCURRENCY = 3
# Yelp の検索半径の上限（m）
YELP_MAX_RADIUS_M = 40000

# お気に入りの店舗情報を 1 回で取得できる件数の上限（フロントの FAVORITES_MAX と合わせる）
LOOKUP_MAX_IDS = 50
# 店舗詳細の取得で同時に実行する Yelp リクエスト数の上限
LOOKUP_YELP_CONCURRENCY = 3
# Yelp の店舗 ID の形式（英数字・ハイフン・アンダースコア）
BUSINESS_ID_PATTERN = re.compile(r"^[A-Za-z0-9_-]{1,64}$")

# FastAPI アプリを作成する
app = FastAPI(title="FindRestr API")

# CORS で許可する公開先のフロントエンドの URL（環境変数 FRONTEND_ORIGIN、カンマ区切りで複数可）
FRONTEND_ORIGINS = [o.strip() for o in os.getenv("FRONTEND_ORIGIN", "").split(",") if o.strip()]

# 公開先のフロントエンドと、ローカル開発（localhost の任意ポート）からのアクセスを許可
app.add_middleware(
    CORSMiddleware,
    allow_origins=FRONTEND_ORIGINS,  # 公開先（Render の URL）
    allow_origin_regex=r"https?://(localhost|127\.0\.0\.1)(:\d+)?",  # ローカル開発用
    allow_methods=["GET"],  # GET のみ許可
    allow_headers=["*"],  # ヘッダーはすべて許可
)


class Category(BaseModel):
    """店舗のカテゴリ"""

    alias: str  # Yelp のカテゴリ ID（例: sushi）
    title: str  # 日本語の表示名（categories_ja.py で変換。対訳がなければ Yelp の英語名）


class GenreFacet(Category):
    """ジャンルの選択肢（件数付きのカテゴリ）"""

    count: int  # このカテゴリを持つ店舗数


class Shop(BaseModel):
    """店舗 1 件（フロントの Restaurant 型と 1:1）"""

    id: str  # 店舗 ID
    name: str  # 店名
    prefecture: str  # 都道府県
    area: str  # 市区町村・エリア
    # 現在地検索では現在地からの距離、ルート検索ではルートからの距離（m）
    distance: Optional[float] = None
    along: Optional[float] = None  # ルート検索のみ：出発地からの道のり（m）。ルート順の並び替え用
    lat: Optional[float] = None  # 緯度
    lng: Optional[float] = None  # 経度
    genre: str  # 代表ジャンル（categories の先頭の title）
    categories: list[Category]  # カテゴリ一覧
    budget: int  # 1人あたりの平均予算（円）。Yelp の場合は価格帯からの目安
    rating: float  # 評価
    review_count: int  # レビュー数
    description: str  # 説明文
    image: str  # 画像 URL
    url: Optional[str] = None  # Yelp の店舗ページ
    parking: Optional[bool] = None  # 駐車場の有無（Yelp に情報がなければ None）
    good_for_groups: Optional[bool] = None  # 大人数OK か（Yelp に情報がなければ None）


class ShopsResponse(BaseModel):
    """/api/shops のレスポンス"""

    total: int  # 絞り込み前の総件数
    items: list[Shop]  # 絞り込み後の店舗
    # ジャンルの選択肢。エリア内の全店舗（ジャンル・評価・予算で絞り込む前）のカテゴリを集計したもの
    genres: list[GenreFacet]
    source: Literal["yelp", "mock"]  # データの取得元


class RouteInfo(BaseModel):
    """ルートの形状と距離・所要時間"""

    coordinates: list[tuple[float, float]]  # [lat, lng] の列（地図描画用）
    distance_m: float  # 総距離（m）
    duration_s: float  # 所要時間（秒）


class RouteShopsResponse(ShopsResponse):
    """/api/shops/route のレスポンス（ShopsResponse にルート情報を追加）"""

    route: RouteInfo


class LookupResponse(BaseModel):
    """/api/shops/lookup のレスポンス"""

    items: list[Shop]  # 取得できた店舗（指定した ID の順）
    missing: list[str]  # 見つからなかった店舗 ID（閉店・削除など）
    source: Literal["yelp", "mock"]  # データの取得元


class GeocodeResult(BaseModel):
    """地名検索の結果 1 件"""

    name: str  # 地名・住所
    lat: float  # 緯度
    lng: float  # 経度


@app.get("/", include_in_schema=False)
def root() -> RedirectResponse:
    """トップページへのアクセスを /docs にリダイレクトする。

    引数: なし
    返り値: /docs へのリダイレクト応答
    """
    # API サーバーのトップには画面がないので、API ドキュメントへ案内する（アプリの画面はフロント側）
    return RedirectResponse("/docs")


@app.get("/api/health")
def health() -> dict:
    """死活確認。

    引数: なし
    返り値: {"status": "ok", "source": "yelp" または "mock"}
    """
    # API キーがあれば yelp、なければ mock
    return {"status": "ok", "source": "yelp" if yelp.api_key() else "mock"}


@app.get("/api/shops", response_model=ShopsResponse)
async def list_shops(
    prefecture: Optional[str] = Query(None, description="都道府県名。未指定なら東京都"),
    area: Optional[str] = Query(None, description="市区町村・エリア名（完全一致）。未指定なら都道府県全域"),
    lat: Optional[float] = Query(None, ge=-90, le=90, description="現在地の緯度。lng と併せて指定すると prefecture / area より優先"),
    lng: Optional[float] = Query(None, ge=-180, le=180, description="現在地の経度"),
    radius: int = Query(5000, ge=1000, le=5000, description="現在地検索の半径（m）"),
    genre: Optional[list[str]] = Query(None, description="ジャンル（Yelp のカテゴリ alias）。複数指定可（OR条件）"),
    min_rating: float = Query(0, ge=0, le=5, description="評価の下限"),
    max_rating: float = Query(5, ge=0, le=5, description="評価の上限"),
    budget_min: Optional[int] = Query(None, ge=0, description="予算の下限（円）"),
    budget_max: Optional[int] = Query(None, ge=0, description="予算の上限（円）。未指定なら上限なし"),
    parking: bool = Query(False, description="true なら駐車場ありの店だけ（Yelp に情報がない店は除く）"),
    groups: bool = Query(False, description="true なら大人数（4人以上）OK の店だけ（Yelp に情報がない店は除く）"),
) -> ShopsResponse:
    """エリアまたは現在地周辺の店舗を検索し、条件で絞り込んで返す。

    引数: クエリパラメータ（各 Query の description を参照）
    返り値: 店舗一覧・総件数・ジャンルの選択肢・取得元
    例外: HTTPException(502) Yelp API の呼び出しに失敗したとき
    """
    # 緯度・経度が両方あれば現在地検索
    near_me = lat is not None and lng is not None
    if near_me:
        # 現在地検索では都道府県・エリアを使わない
        prefecture = area = None
    else:
        # エリア検索では都道府県の既定値を補う
        prefecture = prefecture or yelp.DEFAULT_PREFECTURE

    if yelp.api_key():
        # API キーがあれば Yelp から取得する
        try:
            total, shops = await yelp.search_shops(prefecture, area, lat, lng, radius_m=radius)
        except yelp.YelpError as e:
            # Yelp の失敗は 502 として返す
            raise HTTPException(status_code=502, detail=str(e)) from e
        source = "yelp"
    else:
        # なければモックデータを使う（現在地検索なら距離を付ける）
        total, shops = len(SHOPS), with_distance(SHOPS, lat, lng) if near_me else SHOPS
        source = "mock"

    # 先にエリアだけで絞り、そこからジャンルの選択肢を作る（選択中の条件で選択肢が消えないように）
    in_area = filter_shops(
        shops,
        prefecture=prefecture,
        area=area,
        max_distance=radius if near_me else None,  # 現在地検索なら半径で絞る
    )
    # エリア内の店舗をジャンル・評価・予算で絞り込む
    items = filter_shops(
        in_area,
        genres=genre,
        min_rating=min_rating,
        max_rating=max_rating,
        budget_min=budget_min,
        budget_max=budget_max,
        parking=parking,
        groups=groups,
    )
    # レスポンスを組み立てて返す
    return ShopsResponse(total=total, items=items, genres=genre_facets(in_area), source=source)


@app.get("/api/shops/route", response_model=RouteShopsResponse)
async def route_shops(
    olat: float = Query(..., ge=-90, le=90, description="出発地の緯度"),
    olng: float = Query(..., ge=-180, le=180, description="出発地の経度"),
    dlat: float = Query(..., ge=-90, le=90, description="目的地の緯度"),
    dlng: float = Query(..., ge=-180, le=180, description="目的地の経度"),
    buffer: int = Query(500, ge=100, le=2000, description="ルートからの距離（m）"),
    genre: Optional[list[str]] = Query(None, description="ジャンル（Yelp のカテゴリ alias）。複数指定可（OR条件）"),
    min_rating: float = Query(0, ge=0, le=5, description="評価の下限"),
    max_rating: float = Query(5, ge=0, le=5, description="評価の上限"),
    budget_min: Optional[int] = Query(None, ge=0, description="予算の下限（円）"),
    budget_max: Optional[int] = Query(None, ge=0, description="予算の上限（円）。未指定なら上限なし"),
    parking: bool = Query(False, description="true なら駐車場ありの店だけ（Yelp に情報がない店は除く）"),
    groups: bool = Query(False, description="true なら大人数（4人以上）OK の店だけ（Yelp に情報がない店は除く）"),
) -> RouteShopsResponse:
    """OSRM で出発地→目的地のルートを引き、ルートから buffer（m）以内の店舗を返す。

    Yelp はルート上の数地点（最大 ROUTE_MAX_SAMPLES）を中心に検索し、結果をまとめてから
    ルートまでの距離で絞り込む。ルートと候補店舗は ROUTE_CACHE_TTL_S 秒キャッシュする。

    引数: クエリパラメータ（各 Query の description を参照）
    返り値: 店舗一覧・総件数・ジャンルの選択肢・取得元・ルート情報
    例外: HTTPException ルート検索（404/502）や Yelp（502）に失敗したとき
    """
    # キャッシュのキー（座標は小数 5 桁≒1m に丸める。Yelp/モックの切り替えも区別する）
    key = (round(olat, 5), round(olng, 5), round(dlat, 5), round(dlng, 5), buffer, bool(yelp.api_key()))
    # キャッシュを引く
    cached = _route_cache.get(key)
    if cached and time.monotonic() - cached[0] < ROUTE_CACHE_TTL_S:
        # 有効期限内ならキャッシュの値を使う
        _, route, candidates, source = cached
    else:
        # なければルートと候補店舗を取得する
        route, candidates, source = await _route_candidates(olat, olng, dlat, dlng, buffer)
        # 上限に達していたら古いものを 1 件捨てる
        if len(_route_cache) >= ROUTE_CACHE_MAX:
            _route_cache.pop(next(iter(_route_cache)))  # 一番古いものを捨てる
        # 取得時刻とともにキャッシュする
        _route_cache[key] = (time.monotonic(), route, candidates, source)
    # 距離計算用のルート形状を作る
    geometry = routing.RouteGeometry(route.coordinates)

    # ルートから buffer 以内の店舗
    near_route = []
    for shop in candidates:
        # 座標がない店舗はスキップ
        if shop.get("lat") is None or shop.get("lng") is None:
            continue
        # ルートまでの距離と、出発地からの道のりを求める
        distance, along = geometry.locate((shop["lat"], shop["lng"]))
        # buffer 以内なら距離・道のりを付けて追加する
        if distance <= buffer:
            near_route.append({**shop, "distance": distance, "along": along})

    # ジャンル・評価・予算で絞り込む
    items = filter_shops(
        near_route,
        genres=genre,
        min_rating=min_rating,
        max_rating=max_rating,
        budget_min=budget_min,
        budget_max=budget_max,
        parking=parking,
        groups=groups,
    )
    # レスポンスを組み立てて返す
    return RouteShopsResponse(
        total=len(candidates),  # ルート周辺で取得した候補の数
        items=items,
        genres=genre_facets(near_route),  # ルート沿いの店舗からジャンルの選択肢を作る
        source=source,
        route=RouteInfo(
            coordinates=route.coordinates,
            distance_m=route.distance_m,
            duration_s=route.duration_s,
        ),
    )


# ルート検索の結果（ルートと候補店舗）のキャッシュ。ジャンル等の変更のたびに OSRM / Yelp を呼ばないため
ROUTE_CACHE_TTL_S = 600  # 有効期限（秒）
ROUTE_CACHE_MAX = 32  # 最大件数
# キー → (取得時刻, ルート, 候補店舗, 取得元)
_route_cache: dict[tuple, tuple[float, routing.Route, list[dict], str]] = {}


async def _route_candidates(
    olat: float, olng: float, dlat: float, dlng: float, buffer: int
) -> tuple[routing.Route, list[dict], str]:
    """ルートを取得し、ルート周辺の候補店舗を集める。

    引数:
        olat, olng: 出発地の緯度・経度
        dlat, dlng: 目的地の緯度・経度
        buffer: ルートからの距離（m）。Yelp の検索半径の決定に使う
    返り値:
        (ルート, 候補店舗のリスト, 取得元 "yelp" / "mock")
    例外:
        HTTPException: ルート検索や Yelp の呼び出しに失敗したとき
    """
    try:
        # OSRM でルートを取得する
        route = await routing.fetch_route((olat, olng), (dlat, dlng))
    except routing.RoutingError as e:
        # RoutingError のステータスコードをそのまま HTTP エラーにする
        raise HTTPException(status_code=e.status_code, detail=str(e)) from e
    # 距離計算・サンプリング用のルート形状
    geometry = routing.RouteGeometry(route.coordinates)

    if yelp.api_key():
        # 検索円がルートに沿って重なるよう、間隔と半径を決める
        # 半径は buffer の 2 倍以上・最低 1500m
        radius = max(buffer * 2, 1500)
        # 地点の間隔：最大地点数に収まる間隔か半径の大きい方
        spacing = max(geometry.length / (ROUTE_MAX_SAMPLES - 1), radius)
        # 間隔の 0.75 倍以上にして円が重なるようにし、Yelp の上限で抑える
        radius = min(YELP_MAX_RADIUS_M, max(radius, math.ceil(spacing * 0.75)))
        # 同時実行数を制限するセマフォ
        semaphore = asyncio.Semaphore(ROUTE_YELP_CONCURRENCY)

        async def search(p: routing.LatLng) -> list[dict]:
            """1 地点を中心に Yelp を検索する。

            引数: p 中心地点 (lat, lng)
            返り値: 店舗のリスト
            """
            # セマフォで同時実行数を制限しつつ検索し、店舗リストだけを返す
            async with semaphore:
                return (await yelp.search_shops(None, None, p[0], p[1], radius_m=radius))[1]

        try:
            # ルート上の各地点で並行して検索する
            batches = await asyncio.gather(*(search(p) for p in geometry.sample(spacing)))
        except yelp.YelpError as e:
            # Yelp の失敗は 502 として返す
            raise HTTPException(status_code=502, detail=str(e)) from e
        # 重複する店舗を id でまとめる
        candidates = list({s["id"]: s for batch in batches for s in batch}.values())
        return route, candidates, "yelp"
    # API キーがなければモックデータを候補にする
    return route, SHOPS, "mock"


@app.get("/api/shops/lookup", response_model=LookupResponse)
async def lookup_shops(
    ids: list[str] = Query(..., alias="id", description=f"店舗 ID。複数指定可（最大 {LOOKUP_MAX_IDS} 件）"),
) -> LookupResponse:
    """店舗 ID から最新の店舗情報を返す（お気に入りの一覧表示用）。

    Yelp の利用規約で店舗 ID 以外のデータは 24 時間を超えて保存できないため、
    フロントは店舗 ID だけを保存し、一覧を開くたびにここで最新の情報を取得する。

    引数: ids 店舗 ID のリスト（クエリパラメータ id を複数回指定）
    返り値: 取得できた店舗（指定順）・見つからなかった店舗 ID・取得元
    例外: HTTPException 422 件数超過・ID の形式が不正なとき、502 Yelp の呼び出しに失敗したとき
    """
    # 重複を除く（指定順は保つ）
    ids = list(dict.fromkeys(ids))
    # 件数の上限を超えたらエラー（Yelp の呼び出し回数を抑えるため）
    if len(ids) > LOOKUP_MAX_IDS:
        raise HTTPException(status_code=422, detail=f"一度に取得できるのは {LOOKUP_MAX_IDS} 件までです")
    # ID の形式が不正ならエラー（URL のパスに入れるため）
    if not all(BUSINESS_ID_PATTERN.match(i) for i in ids):
        raise HTTPException(status_code=422, detail="店舗 ID の形式が正しくありません")

    if not yelp.api_key():
        # API キーがなければモックデータから探す
        found = {i: SHOPS_BY_ID[i] for i in ids if i in SHOPS_BY_ID}
        source = "mock"
    else:
        # キャッシュにない ID だけ Yelp から取得する
        now = time.monotonic()
        to_fetch = [i for i in ids if not (i in _lookup_cache and now - _lookup_cache[i][0] < LOOKUP_CACHE_TTL_S)]
        if to_fetch:
            # 同時実行数を制限するセマフォ
            semaphore = asyncio.Semaphore(LOOKUP_YELP_CONCURRENCY)
            try:
                async with yelp.make_client() as client:

                    async def fetch(business_id: str) -> Optional[dict]:
                        """1 店舗の詳細を取得する（引数: 店舗 ID / 返り値: 店舗、見つからなければ None）"""
                        async with semaphore:
                            return await yelp.get_shop(client, business_id)

                    # 並行して取得する
                    shops = await asyncio.gather(*(fetch(i) for i in to_fetch))
            except yelp.YelpError as e:
                # Yelp の失敗は 502 として返す
                raise HTTPException(status_code=502, detail=str(e)) from e
            # 取得結果（見つからなかったものは None）をキャッシュする
            for business_id, shop in zip(to_fetch, shops):
                _cache_lookup(business_id, shop)
        # キャッシュから見つかった店舗を集める
        found = {i: _lookup_cache[i][1] for i in ids if _lookup_cache.get(i, (0, None))[1] is not None}
        source = "yelp"

    # 指定順に並べ、見つからなかった ID は missing に入れる
    return LookupResponse(
        items=[found[i] for i in ids if i in found],
        missing=[i for i in ids if i not in found],
        source=source,
    )


# 店舗詳細のキャッシュ。お気に入り一覧を開くたびに Yelp を呼び直さないため
# （Yelp の利用規約で、店舗 ID 以外のデータは 24 時間を超えて保存できないので短めにする）
LOOKUP_CACHE_TTL_S = 600  # 有効期限（秒）
LOOKUP_CACHE_MAX = 500  # 最大件数
# 店舗 ID → (取得時刻, 店舗。見つからなければ None)
_lookup_cache: dict[str, tuple[float, Optional[dict]]] = {}


def _cache_lookup(business_id: str, shop: Optional[dict]) -> None:
    """店舗詳細をキャッシュに保存する（上限を超えたら一番古いものを捨てる）。

    引数:
        business_id: 店舗 ID
        shop: 店舗（見つからなかった場合は None）
    返り値: なし
    """
    # 上書きのときは位置を最新にするため、いったん消す
    _lookup_cache.pop(business_id, None)
    # 上限に達していたら一番古いものを捨てる
    if len(_lookup_cache) >= LOOKUP_CACHE_MAX:
        _lookup_cache.pop(next(iter(_lookup_cache)))
    # 取得時刻とともに保存する
    _lookup_cache[business_id] = (time.monotonic(), shop)


@app.get("/api/geocode", response_model=list[GeocodeResult])
async def geocode(q: str = Query(..., min_length=1, max_length=200, description="地名・住所・駅名など")):
    """地名から座標の候補を返す。

    引数: q 地名・住所・駅名など（1〜200 文字）
    返り値: 候補のリスト [{name, lat, lng}]
    例外: HTTPException 地名検索に失敗したとき
    """
    try:
        # Nominatim で地名検索する
        return await routing.geocode(q)
    except routing.RoutingError as e:
        # RoutingError のステータスコードをそのまま HTTP エラーにする
        raise HTTPException(status_code=e.status_code, detail=str(e)) from e
