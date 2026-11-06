"""お気に入り：登録・一覧・解除・保存・取得できない店舗・エラー・絞り込み・並び替え"""

import json
import re

import pytest
from playwright.sync_api import Locator, Page, expect

from helpers import FakeApi, api_request, choose_option, filter_panel, results
from testdata import FAVORITE_IDS

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


def open_saved_favorites(page: Page, base_url: str, ids: list[str]) -> None:
    """店舗 ID を保存済みの状態にして、お気に入りの一覧を直接開く"""
    page.add_init_script(f"localStorage.setItem('findrestr:favorites', {json.dumps(json.dumps(ids))})")
    with page.expect_request(api_request("/api/shops/lookup", id=ids)):
        page.goto(f"{base_url}/#favorites")


def favorite_names(page: Page) -> Locator:
    return favorites_list(page).get_by_role("heading", level=3)


def favorites_panel(page: Page) -> Locator:
    return page.locator("#favorites-filter-panel")


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
    open_saved_favorites(page, base_url, ["ramen-1", "closed-1"])

    expect(favorite_names(page)).to_have_text(["麺屋 テスト"])
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


# ---- 一覧の絞り込み・並び替え（ブラウザ側で行うので API は呼び直さない） ----------


def test_filter_favorites_by_area(page: Page, api: FakeApi, base_url: str):
    open_saved_favorites(page, base_url, FAVORITE_IDS)
    expect(favorite_names(page)).to_have_text(["串カツ テスト", "鮨 テスト", "カフェ テスト", "麺屋 テスト"])
    lookups = len(api.calls_to("/api/shops/lookup"))
    expect(favorites_list(page)).to_contain_text("4件（お気に入り 4 件中）")

    # 選択肢はお気に入りにある都道府県・市区町村だけ（件数付き）
    panel = favorites_panel(page)
    city = panel.get_by_role("combobox", name="市区町村")
    expect(city).to_be_disabled()
    choose_option(page, panel.locator("#favorites-prefecture"), "東京都（3）")
    expect(favorite_names(page)).to_have_text(["鮨 テスト", "カフェ テスト", "麺屋 テスト"])
    choose_option(page, city, "渋谷（1）")
    expect(favorite_names(page)).to_have_text(["カフェ テスト"])

    # 都道府県を変えると市区町村は「全域」に戻る
    choose_option(page, panel.locator("#favorites-prefecture"), "大阪府（1）")
    expect(favorite_names(page)).to_have_text(["串カツ テスト"])
    expect(city).to_contain_text("大阪府全域")
    assert len(api.calls_to("/api/shops/lookup")) == lookups  # 絞り込みでは API を呼ばない


def test_filter_favorites_by_current_location(page: Page, api: FakeApi, base_url: str):
    open_saved_favorites(page, base_url, FAVORITE_IDS)
    panel = favorites_panel(page)

    # 現在地（渋谷駅付近）から 5km 以内だけになり、距離を表示する
    panel.get_by_role("button", name="現在地から探す").click()
    expect(favorite_names(page)).to_have_text(["カフェ テスト", "麺屋 テスト"])
    card = favorites_list(page).get_by_role("listitem").filter(has_text="麺屋 テスト")
    expect(card).to_contain_text("現在地から")

    panel.get_by_role("button", name="現在地での検索を解除").click()
    expect(favorite_names(page)).to_have_count(4)


def test_filter_favorites_by_conditions(page: Page, api: FakeApi, base_url: str):
    open_saved_favorites(page, base_url, FAVORITE_IDS)
    expect(favorite_names(page)).to_have_count(4)
    lookups = len(api.calls_to("/api/shops/lookup"))
    panel = favorites_panel(page)
    reset = panel.get_by_role("button", name="リセット")

    # 設備（両方選ぶと両方を満たす店だけ）
    panel.locator("#facility-parking").click()
    expect(favorite_names(page)).to_have_text(["串カツ テスト", "麺屋 テスト"])
    panel.locator("#facility-groups").click()
    expect(favorite_names(page)).to_have_text(["麺屋 テスト"])
    reset.click()

    # ジャンル（選択肢はお気に入りのカテゴリから作る。複数は OR 条件）
    panel.locator("#genre-sushi").click()
    expect(favorite_names(page)).to_have_text(["鮨 テスト"])
    panel.locator("#genre-kushikatsu").click()
    expect(favorite_names(page)).to_have_text(["串カツ テスト", "鮨 テスト"])
    reset.click()

    # 予算（下限を ¥3,000 に）
    lower = panel.get_by_role("slider", name="予算の下限")
    lower.focus()
    for _ in range(6):  # ¥0 → ¥3,000（¥500 刻み）
        lower.press("ArrowRight")
    expect(favorite_names(page)).to_have_text(["鮨 テスト", "カフェ テスト"])
    reset.click()

    # 評価（下限を 4.5 に）
    rating = panel.get_by_role("slider", name="評価の下限")
    rating.focus()
    for _ in range(9):  # 0.0 → 4.5（0.5 刻み）
        rating.press("ArrowRight")
    expect(favorite_names(page)).to_have_text(["鮨 テスト", "麺屋 テスト"])
    assert len(api.calls_to("/api/shops/lookup")) == lookups  # 絞り込みでは API を呼ばない


def test_no_favorites_match_and_reset(page: Page, api: FakeApi, base_url: str):
    open_saved_favorites(page, base_url, ["cafe-1"])
    favorites_panel(page).locator("#facility-parking").click()
    expect(favorites_list(page)).to_contain_text("条件に合うお気に入りはありません")

    favorites_list(page).get_by_role("button", name="条件をリセット").click()
    expect(favorite_names(page)).to_have_text(["カフェ テスト"])


@pytest.mark.parametrize(
    ("label", "expected"),
    [
        ("価格の安い順", ["麺屋 テスト", "串カツ テスト", "カフェ テスト", "鮨 テスト"]),
        ("価格の高い順", ["鮨 テスト", "カフェ テスト", "串カツ テスト", "麺屋 テスト"]),
        ("評価の高い順", ["鮨 テスト", "麺屋 テスト", "串カツ テスト", "カフェ テスト"]),
        ("登録の新しい順", ["串カツ テスト", "鮨 テスト", "カフェ テスト", "麺屋 テスト"]),
    ],
)
def test_sort_favorites(page: Page, api: FakeApi, base_url: str, label: str, expected: list[str]):
    open_saved_favorites(page, base_url, FAVORITE_IDS)
    choose_option(page, page.locator("#favorites-sort"), label)
    expect(favorite_names(page)).to_have_text(expected)


def test_sort_favorites_by_name(page: Page, api: FakeApi, base_url: str):
    open_saved_favorites(page, base_url, FAVORITE_IDS)
    choose_option(page, page.locator("#favorites-sort"), "名前順")

    # 日本語の照合順（カタカナ → 漢字）で並ぶ
    names = ["串カツ テスト", "鮨 テスト", "カフェ テスト", "麺屋 テスト"]
    expected = page.evaluate("names => [...names].sort((a, b) => a.localeCompare(b, 'ja'))", names)
    assert expected[0] == "カフェ テスト"
    expect(favorite_names(page)).to_have_text(expected)
