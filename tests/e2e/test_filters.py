"""検索条件：ジャンル・予算・評価・リセット"""

from playwright.sync_api import Page, expect

from helpers import FakeApi, api_request, filter_panel
from testdata import MANY_GENRES, shops_response


def test_genre_options_come_from_api(search_page: Page):
    panel = filter_panel(search_page)
    for alias, title in [("ramen", "ラーメン"), ("cafes", "カフェ"), ("sushi", "寿司")]:
        expect(panel.locator(f"#genre-{alias}")).to_be_visible()
        expect(panel.locator(f"label[for='genre-{alias}']")).to_contain_text(title)


def test_select_multiple_genres(search_page: Page):
    page = search_page
    with page.expect_request(api_request("/api/shops", genre="ramen")):
        page.locator("#genre-ramen").click()
    with page.expect_request(api_request("/api/shops", genre=["ramen", "sushi"])):
        page.locator("#genre-sushi").click()
    expect(filter_panel(page)).to_contain_text("2件選択")

    with page.expect_request(api_request("/api/shops", genre="sushi")):
        page.locator("#genre-ramen").click()


def test_selected_genre_stays_when_missing_from_new_results(search_page: Page, api: FakeApi):
    """エリアを変えて選択肢から消えても、選択中のジャンルは表示し続ける"""
    page = search_page
    with page.expect_request(api_request("/api/shops", genre="sushi")):
        page.locator("#genre-sushi").click()

    api.respond("/api/shops", shops_response(items=[], genres=[]))
    with page.expect_request(api_request("/api/shops", area="渋谷")):
        page.get_by_role("combobox", name="市区町村").click()
        page.get_by_role("option", name="渋谷", exact=True).click()
    expect(page.locator("#genre-sushi")).to_be_checked()
    expect(page.locator("#genre-ramen")).to_have_count(0)


def test_show_more_genres(page: Page, api: FakeApi, open_search):
    api.respond("/api/shops", shops_response(genres=MANY_GENRES))
    open_search()
    panel = filter_panel(page)
    genres = panel.locator("button[role='checkbox'][id^='genre-']")  # 設備のチェックボックスは数えない
    expect(genres).to_have_count(12)

    panel.get_by_role("button", name="もっと見る（残り3件）").click()
    expect(genres).to_have_count(15)
    panel.get_by_role("button", name="閉じる").click()
    expect(genres).to_have_count(12)


def test_budget_range(search_page: Page):
    page = search_page
    upper = page.get_by_role("slider", name="予算の上限")
    with page.expect_request(api_request("/api/shops", budget_max=19500, budget_min=None)):
        upper.focus()
        upper.press("ArrowLeft")
    expect(filter_panel(page)).to_contain_text("¥0 〜 ¥19,500")

    lower = page.get_by_role("slider", name="予算の下限")
    with page.expect_request(api_request("/api/shops", budget_min=1000, budget_max=19500)):
        lower.focus()
        lower.press("ArrowRight")
        lower.press("ArrowRight")
    expect(filter_panel(page)).to_contain_text("¥1,000 〜 ¥19,500")


def test_rating_range(search_page: Page):
    page = search_page
    expect(filter_panel(page)).to_contain_text("指定なし")

    lower = page.get_by_role("slider", name="評価の下限")
    with page.expect_request(api_request("/api/shops", min_rating=4, max_rating=None)):
        lower.focus()
        for _ in range(8):  # 0.0 → 4.0（0.5 刻み）
            lower.press("ArrowRight")

    upper = page.get_by_role("slider", name="評価の上限")
    with page.expect_request(api_request("/api/shops", min_rating=4, max_rating=4.5)):
        upper.focus()
        upper.press("ArrowLeft")
    expect(filter_panel(page)).to_contain_text("4.0 〜 4.5")


def test_facility_filters(search_page: Page):
    page = search_page
    with page.expect_request(api_request("/api/shops", parking="true", groups=None)):
        page.locator("#facility-parking").click()
    with page.expect_request(api_request("/api/shops", parking="true", groups="true")):
        page.locator("#facility-groups").click()

    with page.expect_request(api_request("/api/shops", parking=None, groups="true")):
        page.locator("#facility-parking").click()


def test_reset(search_page: Page):
    page = search_page
    reset = filter_panel(page).get_by_role("button", name="リセット")
    expect(reset).to_be_disabled()

    with page.expect_request(api_request("/api/shops", genre="ramen")):
        page.locator("#genre-ramen").click()
    expect(reset).to_be_enabled()

    with page.expect_request(api_request("/api/shops", prefecture="東京都", genre=None)):
        reset.click()
    expect(page.locator("#genre-ramen")).not_to_be_checked()
    expect(reset).to_be_disabled()
