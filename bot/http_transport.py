"""Асинхронный HTTP-транспорт для передачи Telegram-событий Vibee."""

import asyncio
from datetime import datetime, timezone
from math import isfinite
from typing import Callable
from urllib.parse import quote
from uuid import uuid4

import httpx

from .intake import BindingStatus


class TransportError(Exception):
    """Сетевая ошибка или непредвиденный ответ сервера без данных события."""


class StaleRevisionError(TransportError):
    """Сервер отклонил событие из-за устаревшей ревизии."""


class PausedError(TransportError):
    """Сервер запретил передачу; локальный intake должен остановиться."""


class DeliveryUncertainError(TransportError):
    """Delivery may have committed; the binding needs a confirmed server pause."""


class HttpTransport:
    """Отправляет сообщения и читает статус привязки через HTTP API."""

    def __init__(
        self,
        base_url: str,
        binding_id: str,
        token: str,
        client: httpx.AsyncClient | None = None,
        now: Callable[[], datetime] | None = None,
        sleep: Callable[[float], object] | None = None,
    ) -> None:
        self._base_url = base_url.rstrip("/")
        self._raw_binding_id = binding_id
        self._binding_id = quote(binding_id, safe="")
        self._token = token
        self._client = client or httpx.AsyncClient(timeout=5.0)
        self._owns_client = client is None
        self._now = now or (lambda: datetime.now(timezone.utc))
        self._sleep = sleep or asyncio.sleep

    async def send_text(self, event: dict[str, object]) -> dict[str, object]:
        """Передаёт только контрактные поля и отображает ответы API."""
        fields = ("eventId", "expectedRevision", "chatId", "messageId", "senderId", "sentAt", "text")
        payload = {field: event[field] for field in fields}
        url = f"{self._base_url}/api/bot/v1/bindings/{self._binding_id}/events"
        try:
            sent_at = datetime.fromisoformat(str(payload["sentAt"]).replace("Z", "+00:00"))
        except ValueError:
            raise TransportError("Invalid event timestamp") from None
        if sent_at.tzinfo is None:
            raise TransportError("Invalid event timestamp")
        for attempt in range(3):
            if (self._now() - sent_at).total_seconds() > 60:
                break
            try:
                response = await self._client.post(url, headers=self._headers(), json=payload)
            except (httpx.TimeoutException, httpx.RequestError):
                response = None
            if response is not None:
                if response.status_code not in {429} and response.status_code < 500:
                    body = self._response_body(response)
                    if response.status_code == 200 and body.get("result") in {"accepted", "duplicate", "paused"}:
                        return body
                    code = self._error_code(body)
                    if response.status_code == 409 and code == "STALE_REVISION":
                        raise StaleRevisionError("Binding revision is stale")
                    if response.status_code == 403 and code == "FORBIDDEN":
                        raise PausedError("Server rejected sender; local intake paused")
                    if response.status_code == 409 and code == "CONSENT_REQUIRED":
                        raise PausedError("Server requires consent; local intake paused")
                    raise TransportError("Vibee API rejected event delivery")
            if attempt < 2:
                delay = float(attempt + 1)
                if response is not None and response.status_code == 429:
                    try:
                        retry_after = float(response.headers.get("Retry-After", "0"))
                        if isfinite(retry_after):
                            delay = max(delay, retry_after)
                    except ValueError:
                        pass
                if delay < 0 or (self._now() - sent_at).total_seconds() + delay > 60:
                    break
                await self._sleep(delay)
        raise DeliveryUncertainError("Vibee event delivery could not be confirmed")

    async def pause_transport_gap(self, expected_revision: int) -> BindingStatus:
        url = f"{self._base_url}/api/bot/v1/bindings/{self._binding_id}/pause"
        try:
            response = await self._client.post(url, headers=self._headers(), json={
                "requestId": str(uuid4()), "expectedRevision": expected_revision, "reason": "transport_gap",
            })
        except (httpx.TimeoutException, httpx.RequestError) as error:
            raise TransportError("Vibee pause request failed") from error
        body = self._response_body(response)
        if response.status_code == 409 and self._error_code(body) == "STALE_REVISION":
            raise StaleRevisionError("Binding revision is stale")
        if response.status_code != 200 or body.get("phase") != "paused":
            raise TransportError("Vibee pause was not confirmed")
        try:
            return BindingStatus(body["phase"], body["revision"], body["policyVersion"], body["rosterVersion"])
        except (KeyError, TypeError):
            raise TransportError("Vibee returned an invalid pause response") from None

    async def get_binding_status(self, binding_id: str | None = None) -> BindingStatus | dict[str, object]:
        """Загружает серверную ревизию и фазу привязки."""
        self._check_binding_id(binding_id)
        url = f"{self._base_url}/api/bot/v1/bindings/{self._binding_id}"
        response = await self._get(url)
        body = self._response_body(response)
        if response.status_code != 200:
            return body
        try:
            return BindingStatus(
                phase=body["phase"],
                revision=body["revision"],
                policyVersion=body["policyVersion"],
                rosterVersion=body["rosterVersion"],
            )
        except (KeyError, TypeError):
            raise TransportError("Vibee API returned an invalid binding status") from None

    async def get_summary(self, binding_id: str | None = None) -> dict[str, object]:
        """Сводка для бота появится после отдельного авторизованного маршрута."""
        self._check_binding_id(binding_id)
        raise TransportError("Telegram summary delivery is not implemented")

    async def close(self) -> None:
        """Закрывает созданный транспортом HTTP-клиент."""
        if self._owns_client:
            await self._client.aclose()

    def _check_binding_id(self, binding_id: str | None) -> None:
        if binding_id is not None and binding_id != self._raw_binding_id:
            raise TransportError("Transport cannot be used for another binding")

    async def _get(self, url: str) -> httpx.Response:
        try:
            return await self._client.get(url, headers=self._headers())
        except httpx.TimeoutException as error:
            raise TransportError("Vibee API request timed out") from error
        except httpx.RequestError as error:
            raise TransportError("Vibee API request failed") from error

    def _headers(self) -> dict[str, str]:
        return {
            "Authorization": f"Bearer {self._token}",
            "Content-Type": "application/json",
        }

    @staticmethod
    def _response_body(response: httpx.Response) -> dict[str, object]:
        try:
            body = response.json()
        except ValueError:
            raise TransportError("Vibee API returned invalid JSON") from None
        if not isinstance(body, dict):
            raise TransportError("Vibee API returned invalid JSON")
        return body

    @staticmethod
    def _error_code(body: dict[str, object]) -> object:
        error = body.get("error")
        return error.get("code") if isinstance(error, dict) else None
