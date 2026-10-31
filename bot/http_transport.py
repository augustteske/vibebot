"""Асинхронный HTTP-транспорт для передачи Telegram-событий Vibee."""

from urllib.parse import quote

import httpx

from .intake import BindingStatus


class TransportError(Exception):
    """Сетевая ошибка или непредвиденный ответ сервера без данных события."""


class StaleRevisionError(TransportError):
    """Сервер отклонил событие из-за устаревшей ревизии."""


class PausedError(TransportError):
    """Сервер запретил передачу; локальный intake должен остановиться."""


class HttpTransport:
    """Отправляет сообщения и читает статус привязки через HTTP API."""

    def __init__(
        self,
        base_url: str,
        binding_id: str,
        token: str,
        client: httpx.AsyncClient | None = None,
    ) -> None:
        self._base_url = base_url.rstrip("/")
        self._raw_binding_id = binding_id
        self._binding_id = quote(binding_id, safe="")
        self._token = token
        self._client = client or httpx.AsyncClient(timeout=10.0)
        self._owns_client = client is None

    async def send_text(self, event: dict[str, object]) -> dict[str, object]:
        """Передаёт только контрактные поля и отображает ответы API."""
        fields = ("eventId", "expectedRevision", "chatId", "messageId", "senderId", "sentAt", "text")
        payload = {field: event[field] for field in fields}
        url = f"{self._base_url}/api/bot/v1/bindings/{self._binding_id}/events"
        try:
            response = await self._client.post(url, headers=self._headers(), json=payload)
        except httpx.TimeoutException as error:
            raise TransportError("Vibee API request timed out") from error
        except httpx.RequestError as error:
            raise TransportError("Vibee API request failed") from error

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
        raise TransportError("Vibee API returned an unexpected response")

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
        """Загружает сводку, если серверный маршрут доступен для бота."""
        self._check_binding_id(binding_id)
        url = f"{self._base_url}/api/telegram/bindings/{self._binding_id}/summary"
        response = await self._get(url)
        return self._response_body(response)

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
