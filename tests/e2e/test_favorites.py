"""お気に入り：登録・一覧・解除・保存・取得できない店舗・エラー"""

import json
import re

from playwright.sync_api import Locator, Page, expect

from helpers import FakeApi, api_request, filter_panel, results

FAVORITES_BUTTON = re.compile(r"^お気に入り\s*\d+$")


def favorites_button(page: Page) -> Locator:
    """ヘッダーのお気に入りボタン（名前は「お気に入り」＋件数）"""
    return page.get_by_role("button", name=FAVORITES_BUTTON)


def favorites_list(page: Page) -> Locator:
    return page.get_by_role("region", name="お気に入りの一覧")


def add_favorite(page: Page, name: str) -> None:
    button = results(page).get_by_role("button", name=f"{name}をお気に入りに追加")
    button.click()
    expect(results(page).get_by_role("button", name=f"{name}をお気に入りから外す")).to_have_attribute(
        "aria-pressed", "true"
    )


def open_favorites(page: Page, ids: list[str]) -> None:
    with page.expect_request(api_request("/api/shops/lookup", id=ids)):
        favorites_button(page).click()
    expect(page).to_have_url(re.compile(r"#favorites$"))


def test_add_and_list_favorites(search_page: Page):
    page = search_page
    expect(favorites_button(page)).to_have_accessible_name(re.compile(r"0$"))

    add_favorite(page, "麺屋 テスト")
    add_favorite(page, "鮨 テスト")
    expect(favorites_button(page)).to_have_accessible_name(re.compile(r"2$"))

    # 新しく登録した順に、店舗 ID だけを API に渡して取得する
    open_favorites(page, ["sushi-1", "ramen-1"])
    expect(favorites_list(page).get_by_role("heading", level=3)).to_have_text(["鮨 テスト", "麺屋 テスト"])


def test_favorites_are_kept_after_reload(search_page: Page):
    page = search_page
    add_favorite(page, "カフェ テスト")

    with page.expect_request(api_request("/api/shops")):
        page.reload()
    expect(
        results(page).get_by_role("button", name="カフェ テストをお気に入りから外す")
    ).to_have_attribute("aria-pressed", "true")
    expect(favorites_button(page)).to_have_accessible_name(re.compile(r"1$"))

    # 保存するのは店舗 ID だけ（Yelp の利用規約により店舗の情報は保存しない）
    stored = page.evaluate("localStorage.getItem('findrestr:favorites')")
    assert json.loads(stored) == ["cafe-1"]


def test_remove_from_favorites_list(search_page: Page):
    page = search_page
    add_favorite(page, "麺屋 テスト")
    open_favorites(page, ["ramen-1"])

    favorites_list(page).get_by_role("button", name="麺屋 テストをお気に入りから外す").click()
    expect(page.get_by_text("お気に入りはまだありません")).to_be_visible()
    expect(favorites_button(page)).to_have_accessible_name(re.compile(r"0$"))

    # 「お店を探す」で検索画面に戻ると、カードのハートも外れている
    page.get_by_role("button", name="お店を探す").click()
    expect(page).to_have_url(re.compile(r"#main-menu$"))
    expect(
        results(page).get_by_role("button", name="麺屋 テストをお気に入りに追加")
    ).to_have_attribute("aria-pressed", "false")


def test_search_conditions_are_kept_while_viewing_favorites(search_page: Page):
    page = search_page
    with page.expect_request(api_request("/api/shops", genre="ramen")):
        page.locator("#genre-ramen").click()
    add_favorite(page, "麺屋 テスト")
    open_favorites(page, ["ramen-1"])

    page.get_by_role("button", name="検索に戻る").click()
    expect(page).to_have_url(re.compile(r"#main-menu$"))
    expect(filter_panel(page).locator("#genre-ramen")).to_be_checked()


def test_unavailable_shops_can_be_removed(page: Page, api: FakeApi, base_url: str):
    # 閉店などで Yelp から取得できなくなった店舗 ID を保存済みの状態にする
    page.add_init_script(
        "localStorage.setItem('findrestr:favorites', JSON.stringify(['ramen-1', 'closed-1']))"
    )
    with page.expect_request(api_request("/api/shops/lookup", id=["ramen-1", "closed-1"])):
        page.goto(f"{base_url}/#favorites")

    expect(favorites_list(page).get_by_role("heading", level=3)).to_have_text(["麺屋 テスト"])
    notice = favorites_list(page).get_by_text("1 件のお店は情報を取得できませんでした")
    expect(notice).to_be_visible()

    favorites_list(page).get_by_role("button", name="お気に入りから削除").click()
    expect(notice).to_have_count(0)
    expect(favorites_button(page)).to_have_accessible_name(re.compile(r"1$"))


def test_lookup_error_and_retry(search_page: Page, api: FakeApi):
    page = search_page
    add_favorite(page, "麺屋 テスト")
    api.respond("/api/shops/lookup", {"detail": "Yelp API error 429: too many requests"}, status=502)
    open_favorites(page, ["ramen-1"])

    alert = page.get_by_role("alert")
    expect(alert).to_contain_text("お気に入りのお店の情報を取得できませんでした")
    expect(alert).to_contain_text("Yelp API error 429")

    api.respond("/api/shops/lookup", lambda q: {"items": [], "missing": q["id"], "source": "yelp"})
    with page.expect_request(api_request("/api/shops/lookup", id=["ramen-1"])):
        alert.get_by_role("button", name="再読み込み").click()
    expect(page.get_by_text("1 件のお店は情報を取得できませんでした")).to_be_visible()
