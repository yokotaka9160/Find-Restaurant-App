"""テストで API の代わりに返すデータ（backend の ShopsResponse / RouteShopsResponse と同じ形）。

並び替えのテストで順序が区別できるよう、店舗ごとに予算・評価・ルート上の位置をずらしている。
  おすすめ順: 麺屋 → 鮨 → カフェ（評価 × log10(レビュー数 + 10)）
  評価順:     鮨 → 麺屋 → カフェ
  価格の安い順: 麺屋 → カフェ → 鮨
  ルート順:   カフェ → 鮨 → 麺屋
"""

from __future__ import annotations

from typing import Optional


def shop(
    id: str,
    name: str,
    alias: str,
    title: str,
    budget: int,
    rating: float,
    review_count: int,
    lat: float,
    lng: float,
    area: str = "新宿",
    distance: Optional[float] = None,
    along: Optional[float] = None,
    parking: Optional[bool] = None,
    good_for_groups: Optional[bool] = None,
) -> dict:
    return {
        "id": id,
        "name": name,
        "prefecture": "東京都",
        "area": area,
        "distance": distance,
        "along": along,
        "lat": lat,
        "lng": lng,
        "genre": title,
        "categories": [{"alias": alias, "title": title}],
        "budget": budget,
        "rating": rating,
        "review_count": review_count,
        "description": f"{title}のお店",
        "image": "",  # 外部の画像を読み込まない
        "url": f"https://www.yelp.com/biz/{id}",
        "parking": parking,
        "good_for_groups": good_for_groups,
    }


RAMEN = shop(
    "ramen-1", "麺屋 テスト", "ramen", "ラーメン", 1000, 4.5, 300, 35.6900, 139.7000,
    parking=True, good_for_groups=True,
)
CAFE = shop("cafe-1", "カフェ テスト", "cafes", "カフェ", 3000, 3.9, 50, 35.6850, 139.7300)
SUSHI = shop("sushi-1", "鮨 テスト", "sushi", "寿司", 15000, 4.8, 120, 35.6800, 139.7650)
SHOPS = [RAMEN, CAFE, SUSHI]


def facets(shops: list[dict]) -> list[dict]:
    counts: dict[str, dict] = {}
    for s in shops:
        for c in s["categories"]:
            counts.setdefault(c["alias"], {**c, "count": 0})["count"] += 1
    return sorted(counts.values(), key=lambda f: -f["count"])


def shops_response(
    items: Optional[list[dict]] = None,
    total: int = 120,
    genres: Optional[list[dict]] = None,
    source: str = "yelp",
) -> dict:
    items = SHOPS if items is None else items
    return {
        "total": total,
        "items": items,
        "genres": facets(items) if genres is None else genres,
        "source": source,
    }


# 選択肢が「もっと見る」（12 件超）になるジャンル
MANY_GENRES = [{"alias": f"genre{i}", "title": f"ジャンル{i}", "count": 20 - i} for i in range(15)]

# ---- ルート検索 -------------------------------------------------------------

ROUTE_SHOPS = [
    {**RAMEN, "distance": 300, "along": 6000},
    {**CAFE, "distance": 100, "along": 100},
    {**SUSHI, "distance": 50, "along": 2500},
]

ROUTE = {
    "coordinates": [[35.6896, 139.7006], [35.6850, 139.7300], [35.6812, 139.7671]],
    "distance_m": 7200,
    "duration_s": 900,
}


def route_response(items: Optional[list[dict]] = None) -> dict:
    return {**shops_response(ROUTE_SHOPS if items is None else items, total=230), "route": ROUTE}


# ---- お気に入り（店舗 ID → 店舗情報） -----------------------------------------


def lookup_response(ids: list[str]) -> dict:
    """/api/shops/lookup の応答。SHOPS にない ID は missing に入れる"""
    by_id = {s["id"]: s for s in SHOPS}
    return {
        "items": [by_id[i] for i in ids if i in by_id],
        "missing": [i for i in ids if i not in by_id],
        "source": "yelp",
    }


# ---- 地名検索 ---------------------------------------------------------------

SHINJUKU = {"name": "新宿駅, 新宿三丁目, 新宿区, 東京都", "lat": 35.6896, "lng": 139.7006}
SHINJUKU_WEST = {"name": "新宿駅西口, 西新宿一丁目, 新宿区, 東京都", "lat": 35.6905, "lng": 139.6990}
TOKYO = {"name": "東京駅, 丸の内一丁目, 千代田区, 東京都", "lat": 35.6812, "lng": 139.7671}

GEOCODE = {
    "新宿駅": [SHINJUKU, SHINJUKU_WEST],
    "東京駅": [TOKYO],
}

# テスト用ブラウザの現在地（渋谷駅付近）
CURRENT_LOCATION = {"latitude": 35.6595, "longitude": 139.7005}
