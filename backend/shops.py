"""モック店舗データと検索ロジック（FastAPI に依存しないので単体でテスト可能）。"""

# 型ヒントを遅延評価する
from __future__ import annotations

# 距離計算に使う数学関数
import math
# 「値または None」と「読み取り専用の配列」の型
from typing import Optional, Sequence

# カテゴリ alias を日本語名に変換する関数
from categories_ja import ja_title


def unsplash(photo_id: str, width: int = 800) -> str:
    """Unsplash の写真 ID から画像 URL を作る。

    引数:
        photo_id: Unsplash の写真 ID
        width: 画像の幅（px、既定 800）
    返り値:
        トリミング・圧縮指定付きの画像 URL
    """
    return f"https://images.unsplash.com/{photo_id}?auto=format&fit=crop&w={width}&q=80"


# モックのジャンル → 店舗画像の URL
GENRE_PHOTO = {
    "寿司": unsplash("photo-1768614437681-704009224482"),
    "ラーメン": unsplash("photo-1779635593399-726a96741c4c"),
    "イタリアン": unsplash("photo-1574071318508-1cdbab80d002"),
    "カフェ": unsplash("photo-1544148103-0773bf10d330"),
    "居酒屋": unsplash("photo-1779635593399-726a96741c4c"),
    "焼肉": unsplash("photo-1779635593399-726a96741c4c"),
    "ポケ": unsplash("photo-1602881917445-0b1ba001addf"),
}

# モック店舗の元データ（id・店名・エリア・ジャンル・予算・評価・レビュー数・説明）
_SEEDS = [
    {"id": 1, "name": "鮨 たかはし", "area": "渋谷", "genre": "寿司", "budget": 18000, "rating": 4.7, "review_count": 312,
     "description": "握りのネタが新鮮で、一貫ごとの満足度が高いカウンター寿司。特別な日のディナーに。"},
    {"id": 2, "name": "トラットリア・ベッロ", "area": "中目黒", "genre": "イタリアン", "budget": 4500, "rating": 4.6, "review_count": 528,
     "description": "薪窯で焼く香ばしいピザとワイン。気取らず楽しめる人気店。"},
    {"id": 3, "name": "カフェ ミナ", "area": "表参道", "genre": "カフェ", "budget": 1200, "rating": 4.2, "review_count": 187,
     "description": "落ち着いた雰囲気で長居OK。自家焙煎コーヒーと焼き菓子が自慢。"},
    {"id": 4, "name": "POKE STAND HANA", "area": "六本木", "genre": "ポケ", "budget": 1800, "rating": 4.1, "review_count": 96,
     "description": "ヘルシー志向に人気のポケボウル専門店。トッピングを自由に選べる。"},
    {"id": 5, "name": "炭火居酒屋 炎", "area": "池袋", "genre": "居酒屋", "budget": 3500, "rating": 4.0, "review_count": 241,
     "description": "気軽に楽しめる串焼きと日本酒。仕事帰りの一杯にちょうどいい。"},
    {"id": 6, "name": "麺屋 雷鳴", "area": "新宿", "genre": "ラーメン", "budget": 1100, "rating": 4.4, "review_count": 1204,
     "description": "濃厚豚骨魚介のつけ麺が名物。昼どきは行列必至。"},
    {"id": 7, "name": "焼肉 銀座 牛蔵", "area": "銀座", "genre": "焼肉", "budget": 12000, "rating": 4.8, "review_count": 402,
     "description": "A5ランクの和牛を個室でゆったり。接待や記念日に最適。"},
    {"id": 8, "name": "オステリア ルーチェ", "area": "恵比寿", "genre": "イタリアン", "budget": 6500, "rating": 4.5, "review_count": 356,
     "description": "季節野菜を使った自家製パスタが評判。ナチュラルワインも豊富。"},
    {"id": 9, "name": "寿司 まるやま", "area": "新宿", "genre": "寿司", "budget": 3200, "rating": 3.8, "review_count": 143,
     "description": "ランチはワンコインから。気軽に入れる立ち食いスタイルの寿司店。"},
    {"id": 10, "name": "珈琲 森の時計", "area": "恵比寿", "genre": "カフェ", "budget": 1500, "rating": 4.3, "review_count": 264,
     "description": "緑に囲まれたテラス席が人気。ふわふわのパンケーキも定番。"},
    {"id": 11, "name": "ラーメン 灯", "area": "池袋", "genre": "ラーメン", "budget": 950, "rating": 3.9, "review_count": 689,
     "description": "あっさり醤油の中華そば。深夜まで営業していて〆に最適。"},
    {"id": 12, "name": "個室居酒屋 しずく", "area": "渋谷", "genre": "居酒屋", "budget": 4800, "rating": 4.2, "review_count": 318,
     "description": "全席個室で宴会向き。旬の魚と地酒のペアリングコースが人気。"},
    {"id": 13, "name": "焼肉 ホルモン酒場 ぼん", "area": "新宿", "genre": "焼肉", "budget": 4200, "rating": 3.7, "review_count": 451,
     "description": "新鮮ホルモンをリーズナブルに。ハイボールとの相性抜群。"},
    {"id": 14, "name": "ALOHA BOWL 青山", "area": "表参道", "genre": "ポケ", "budget": 1600, "rating": 4.0, "review_count": 73,
     "description": "サーモンとアボカドのボウルが看板。テイクアウトにも対応。"},
    {"id": 15, "name": "リストランテ ラ・ルナ", "area": "六本木", "genre": "イタリアン", "budget": 15000, "rating": 4.7, "review_count": 219,
     "description": "ミシュラン掲載のモダンイタリアン。夜景を望むテーブルが人気。"},
    {"id": 16, "name": "鮨 銀座 いわさき", "area": "銀座", "genre": "寿司", "budget": 19000, "rating": 4.9, "review_count": 168,
     "description": "江戸前の伝統を守る名店。おまかせコースのみ、要予約。"},
]

# モック店舗の位置（エリアの中心付近）。現在地検索の距離計算に使う
_AREA_COORDS = {
    "渋谷": (35.6595, 139.7005),
    "表参道": (35.6652, 139.7123),
    "恵比寿": (35.6467, 139.7101),
    "中目黒": (35.6440, 139.6990),
    "六本木": (35.6628, 139.7314),
    "新宿": (35.6909, 139.7003),
    "池袋": (35.7295, 139.7109),
    "銀座": (35.6717, 139.7650),
}

# モックのジャンル → Yelp のカテゴリ（alias, title）。Yelp の結果と同じく title は日本語表記
_GENRE_CATEGORY = {
    # ジャンル名をキーに、(alias, 日本語名) のタプルを値にする
    genre: (alias, ja_title(alias, genre))
    for genre, alias in {
        "寿司": "sushi",
        "ラーメン": "ramen",
        "イタリアン": "italian",
        "カフェ": "cafes",
        "居酒屋": "izakaya",
        "焼肉": "yakiniku",
        "ポケ": "poke",
    }.items()
}


def _jitter(i: int) -> float:
    """同じエリアの店が地図上で重ならないよう、id から決まる小さなずれ（±約500m）

    引数:
        i: 店舗 id などの整数
    返り値:
        緯度・経度に足すずれ（度、-0.005〜+0.005）
    """
    # (i*37) を 11 で割った余り（0〜10）から 5 を引き、0.001 度単位にする
    return ((i * 37) % 11 - 5) * 0.001


# モック店舗の完成データ（Yelp の結果と同じ Shop 形式）
SHOPS = [
    {
        **s,  # 元データをすべて引き継ぐ
        "id": str(s["id"]),  # id は文字列にそろえる
        "prefecture": "東京都",  # モックはすべて東京都
        "genre": _GENRE_CATEGORY[s["genre"]][1],  # 代表ジャンルは日本語名
        "categories": [dict(zip(("alias", "title"), _GENRE_CATEGORY[s["genre"]]))],  # {alias, title} の 1 件
        "lat": _AREA_COORDS[s["area"]][0] + _jitter(s["id"]),  # エリア中心の緯度 + ずれ
        "lng": _AREA_COORDS[s["area"]][1] + _jitter(s["id"] * 3),  # エリア中心の経度 + ずれ
        "image": GENRE_PHOTO[s["genre"]],  # ジャンルに応じた画像
    }
    for s in _SEEDS
]


def distance_m(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    """2 点間の距離（m、ハーバーサイン）

    引数:
        lat1, lng1: 1 点目の緯度・経度
        lat2, lng2: 2 点目の緯度・経度
    返り値:
        大円距離（m）
    """
    # 地球の半径（m）
    r = 6_371_000
    # 緯度をラジアンに変換
    p1, p2 = math.radians(lat1), math.radians(lat2)
    # 緯度差・経度差（ラジアン）
    dp, dl = p2 - p1, math.radians(lng2 - lng1)
    # ハーバーサインの式
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    # 中心角に半径を掛けて距離にする
    return 2 * r * math.asin(math.sqrt(a))


def with_distance(shops: Sequence[dict], lat: float, lng: float) -> list[dict]:
    """各店舗に、指定地点からの距離 distance（m）を付けた新しいリストを返す。

    引数:
        shops: 店舗のリスト（変更しない）
        lat, lng: 基準地点の緯度・経度
    返り値:
        distance を追加した店舗のリスト
    """
    return [{**s, "distance": distance_m(lat, lng, s["lat"], s["lng"])} for s in shops]


def filter_shops(
    shops: Sequence[dict],
    prefecture: Optional[str] = None,
    area: Optional[str] = None,
    genres: Optional[Sequence[str]] = None,  # Yelp のカテゴリ alias。いずれかを含めば一致
    min_rating: float = 0.0,
    max_rating: float = 5.0,
    budget_min: Optional[int] = None,
    budget_max: Optional[int] = None,
    max_distance: Optional[float] = None,
) -> list[dict]:
    """クエリ条件に合致する店舗だけを返す。未指定（None / 空）の条件は無視する。

    引数:
        shops: 絞り込む店舗のリスト
        prefecture: 都道府県
        area: 市区町村・エリア
        genres: カテゴリ alias のリスト（OR 条件）
        min_rating, max_rating: 評価の範囲
        budget_min, budget_max: 予算の範囲（円）
        max_distance: distance の上限（m）
    返り値:
        条件に合う店舗のリスト
    """
    # 条件に合った店舗を入れるリスト
    result = []
    for shop in shops:
        # 都道府県が違えば除外
        if prefecture and shop["prefecture"] != prefecture:
            continue
        # エリアが違えば除外
        if area and shop["area"] != area:
            continue
        # 指定ジャンルを 1 つも持たなければ除外
        if genres and not any(c["alias"] in genres for c in shop["categories"]):
            continue
        # 評価が範囲外なら除外
        if not (min_rating <= shop["rating"] <= max_rating):
            continue
        # 距離が上限を超えれば除外（距離なしは 0 扱い）
        if max_distance is not None and (shop.get("distance") or 0) > max_distance:
            continue
        # 予算が下限未満なら除外
        if budget_min is not None and shop["budget"] < budget_min:
            continue
        # 予算が上限超過なら除外
        if budget_max is not None and shop["budget"] > budget_max:
            continue
        # すべての条件を満たした店舗を追加
        result.append(shop)
    return result


def genre_facets(shops: Sequence[dict]) -> list[dict]:
    """店舗のカテゴリを集計し、件数の多い順に [{alias, title, count}] を返す（ジャンルの選択肢用）

    引数:
        shops: 集計対象の店舗のリスト
    返り値:
        件数の多い順（同数なら表示名順）に並べたジャンルのリスト
    """
    # alias → {alias, title, count} の集計用 dict
    facets: dict[str, dict] = {}
    for shop in shops:
        for c in shop["categories"]:
            # 初出なら count 0 で登録し、既存ならそれを取り出す
            f = facets.setdefault(c["alias"], {"alias": c["alias"], "title": c["title"], "count": 0})
            # 件数を 1 増やす
            f["count"] += 1
    # 件数の降順、同数なら表示名の昇順で並べて返す
    return sorted(facets.values(), key=lambda f: (-f["count"], f["title"]))
