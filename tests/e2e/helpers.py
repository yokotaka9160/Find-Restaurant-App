"""E2E テスト用の API の差し替えと、画面操作・検証のヘルパー。"""

from __future__ import annotations

import json
import re
from typing import Any, Callable, Union
from urllib.parse import parse_qs, urlparse

from playwright.sync_api import Locator, Page, Request, Route

from testdata import GEOCODE, lookup_response, route_response, shops_response

API_URL = re.compile(r"^https?://[^/]+/api/")
TILE_URL = re.compile(r"^https?://([a-z]\.)?tile\.openstreetmap\.org/")

Body = Union[dict, list, Callable[[dict[str, list[str]]], Any]]


class FakeApi:
    """フロントが呼ぶ /api/* を横取りして固定の JSON を返し、呼び出しを記録する。

    respond() で返す内容を差し替えられる。body に関数を渡すとクエリパラメータから組み立てる。
    """

    def __init__(self) -> None:
        self.responses: dict[str, tuple[int, Body]] = {
            "/api/shops": (200, shops_response()),
            "/api/shops/route": (200, route_response()),
            "/api/geocode": (200, lambda q: GEOCODE.get(q["q"][0], [])),
            "/api/shops/lookup": (200, lambda q: lookup_response(q.get("id", []))),
        }
        self.calls: list[tuple[str, dict[str, list[str]]]] = []

    def respond(self, path: str, body: Body, status: int = 200) -> None:
        self.responses[path] = (status, body)

    def calls_to(self, path: str) -> list[dict[str, list[str]]]:
        return [params for p, params in self.calls if p == path]

    def handle(self, route: Route) -> None:
        url = urlparse(route.request.url)
        params = parse_qs(url.query)
        self.calls.append((url.path, params))
        status, body = self.responses.get(url.path, (404, {"detail": "Not Found"}))
        if callable(body):
            body = body(params)
        route.fulfill(
            status=status,
            content_type="application/json",
            # フロント（:8080 など）から API（:8000）へのクロスオリジン呼び出しなので CORS ヘッダーを付ける
            headers={"Access-Control-Allow-Origin": "*"},
            body=json.dumps(body, ensure_ascii=False),
        )

    def install(self, page: Page) -> None:
        page.route(API_URL, self.handle)
        # 地図タイルは取得しない（外部に依存せず速くする）
        page.route(TILE_URL, lambda route: route.abort())


def api_request(path: str, **expected: Any) -> Callable[[Request], bool]:
    """page.expect_request 用の条件。

    expected の値が None ならそのパラメータが無いこと、リストなら複数値が順に一致すること、
    それ以外なら 1 つの値が文字列として一致することを確かめる。
    """

    def match(request: Request) -> bool:
        url = urlparse(request.url)
        if url.path != path:
            return False
        params = parse_qs(url.query)
        for key, value in expected.items():
            if value is None:
                if key in params:
                    return False
            elif params.get(key) != (
                [str(v) for v in value] if isinstance(value, list) else [str(value)]
            ):
                return False
        return True

    return match


# ---- 画面の要素 ---------------------------------------------------------------


def results(page: Page) -> Locator:
    return page.get_by_role("region", name="検索結果")


def card_names(page: Page) -> list[str]:
    return results(page).get_by_role("heading", level=3).all_inner_texts()


def filter_panel(page: Page) -> Locator:
    return page.locator("#filter-panel")


def choose_option(page: Page, trigger: Locator, option: str) -> None:
    """shadcn/ui（Radix）の Select で選択肢を選ぶ"""
    trigger.click()
    page.get_by_role("option", name=option, exact=True).click()
