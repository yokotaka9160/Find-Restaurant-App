"""検索結果：カード表示・並び替え・マップ表示・該当なし・エラー"""

import pytest
from playwright.sync_api import Page, expect

from helpers import FakeApi, api_request, card_names, choose_option, results
from testdata import shops_response


def test_cards_show_shop_details(search_page: Page):
    page = search_page
    expect(results(page)).to_contain_text("件のお店（全120件中）")
    assert card_names(page) == ["麺屋 テスト", "鮨 テスト", "カフェ テスト"]  # おすすめ順

    card = results(page).get_by_role("listitem").filter(has_text="麺屋 テスト")
    expect(card).to_contain_text("ラーメン")
    expect(card).to_contain_text("東京都 新宿")
    expect(card).to_contain_text("平均 ¥1,000")
    expect(card).to_contain_text("4.5")
    expect(card).to_contain_text("(300)")
    expect(card.get_by_role("link", name="Yelpで見る")).to_have_attribute(
        "href", "https://www.yelp.com/biz/ramen-1"
    )
    # 設備は「あり」と分かっているものだけ表示する
    expect(card.get_by_role("list", name="設備")).to_contain_text("駐車場あり")
    expect(card.get_by_role("list", name="設備")).to_contain_text("大人数OK")
    cafe = results(page).get_by_role("listitem").filter(has_text="カフェ テスト")
    expect(cafe.get_by_role("list", name="設備")).to_have_count(0)


@pytest.mark.parametrize(
    ("label", "expected"),
    [
        ("評価の高い順", ["鮨 テスト", "麺屋 テスト", "カフェ テスト"]),
        ("価格の安い順", ["麺屋 テスト", "カフェ テスト", "鮨 テスト"]),
        ("価格の高い順", ["鮨 テスト", "カフェ テスト", "麺屋 テスト"]),
        ("おすすめ順", ["麺屋 テスト", "鮨 テスト", "カフェ テスト"]),
    ],
)
def test_sort(search_page: Page, label: str, expected: list[str]):
    page = search_page
    choose_option(page, page.locator("#sort"), label)
    expect(results(page).get_by_role("heading", level=3)).to_have_text(expected)


def test_route_order_is_not_offered_in_area_search(search_page: Page):
    page = search_page
    page.locator("#sort").click()
    expect(page.get_by_role("option", name="ルート順")).to_have_count(0)


def test_map_view(search_page: Page):
    page = search_page
    page.get_by_role("button", name="マップ").click()
    expect(page.get_by_role("region", name="店舗の地図")).to_be_visible()
    expect(page.locator("path.map-shop-marker")).to_have_count(3)
    expect(page.locator("#sort")).to_have_count(0)  # 地図では並び替えを出さない

    # マーカーをクリックすると店舗の情報が出る
    page.locator("path.map-shop-marker").first.click(force=True)
    popup = page.locator(".leaflet-popup")
    expect(popup).to_be_visible()
    expect(popup.get_by_role("link", name="Yelpで見る →")).to_be_visible()

    page.get_by_role("button", name="リスト").click()
    expect(results(page).get_by_role("heading", level=3)).to_have_count(3)


def test_map_shows_current_location(search_page: Page):
    page = search_page
    with page.expect_request(api_request("/api/shops", radius=5000)):
        page.get_by_role("button", name="現在地から探す").click()
    page.get_by_role("button", name="マップ").click()
    expect(page.locator("path.map-me-marker")).to_have_count(1)
    expect(page.locator("path.map-me-range")).to_have_count(1)


def test_empty_results_and_reset(search_page: Page, api: FakeApi):
    page = search_page
    api.respond("/api/shops", shops_response(items=[]))
    with page.expect_request(api_request("/api/shops", genre="sushi")):
        page.locator("#genre-sushi").click()
    expect(results(page)).to_contain_text("条件に合うお店が見つかりませんでした")
    expect(results(page)).to_contain_text("件のお店（全120件中）")

    # 「条件をリセット」で初期条件に戻して再検索する
    api.respond("/api/shops", shops_response())
    with page.expect_request(api_request("/api/shops", prefecture="東京都", genre=None)):
        results(page).get_by_role("button", name="条件をリセット").click()
    expect(results(page).get_by_role("heading", level=3)).to_have_count(3)


def test_api_error_and_retry(page: Page, api: FakeApi, open_search):
    api.respond("/api/shops", {"detail": "Yelp API error 401: invalid key"}, status=502)
    open_search()
    alert = results(page).get_by_role("alert")
    expect(alert).to_contain_text("店舗データを取得できませんでした")
    expect(alert).to_contain_text("Yelp API error 401: invalid key")

    api.respond("/api/shops", shops_response())
    with page.expect_request(api_request("/api/shops")):
        alert.get_by_role("button", name="再読み込み").click()
    expect(results(page).get_by_role("heading", level=3)).to_have_count(3)


@pytest.mark.parametrize(
    ("source", "text"),
    [("yelp", "Powered by"), ("mock", "サンプルデータを表示中")],
)
def test_data_source_note(page: Page, api: FakeApi, open_search, source: str, text: str):
    api.respond("/api/shops", shops_response(source=source))
    open_search()
    expect(results(page)).to_contain_text(text)
