"""Bounded synthetic compatibility/security checks for the dependency upgrade.

The SSH-key and parse_form checks exercise library contracts. Golf currently uses
an explicit JWT algorithm allowlist and has no multipart endpoint; these tests do
not establish that the production app exposed either vulnerable library path.
"""

from __future__ import annotations

import base64
import io
import secrets
import time

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec
from jose import jwt
from jose.exceptions import JWSError
from multipart import MultipartParser, parse_form
from multipart.exceptions import MultipartParseError
import pytest


def test_application_jwt_round_trip():
    from app.security import create_access_token, decode_token

    payload = decode_token(create_access_token(17, "staff"))
    assert payload is not None
    assert payload["sub"] == "17"
    assert payload["role"] == "staff"


@pytest.mark.parametrize(
    "case", ["wrong-key", "expired", "other-algorithm", "unsigned"]
)
def test_application_jwt_rejects_invalid_tokens(case):
    from app.config import settings
    from app.security import decode_token

    payload = {"sub": "17", "role": "staff", "exp": int(time.time()) + 60}
    if case == "unsigned":
        # Only synthetic public claims, never a real session token.
        header = base64.urlsafe_b64encode(b'{"alg":"none","typ":"JWT"}').rstrip(b"=")
        body = base64.urlsafe_b64encode(b'{"sub":"17","role":"staff"}').rstrip(b"=")
        token = header.decode() + "." + body.decode() + "."
    else:
        if case == "expired":
            payload["exp"] = int(time.time()) - 60
        key = secrets.token_hex(64) if case == "wrong-key" else settings.SECRET_KEY
        algorithm = settings.JWT_ALG
        if case == "other-algorithm":
            algorithm = "HS512" if algorithm != "HS512" else "HS256"
        token = jwt.encode(payload, key, algorithm=algorithm)
    assert decode_token(token) is None


def test_jose_rejects_openssh_public_key_as_hmac_secret():
    # GHSA-6c5p-j8vq-pqhj: generated ephemeral public key, no credentials/files.
    public_key = (
        ec.generate_private_key(ec.SECP256R1())
        .public_key()
        .public_bytes(
            serialization.Encoding.OpenSSH, serialization.PublicFormat.OpenSSH
        )
    )
    with pytest.raises(JWSError, match="asymmetric key"):
        jwt.encode({"sub": "synthetic"}, public_key, algorithm="HS256")


class ReadAudit(io.BytesIO):
    def __init__(self, data):
        super().__init__(data)
        self.read_sizes = []

    def read(self, size=-1):
        self.read_sizes.append(size)
        return super().read(size)


def test_multipart_rejects_negative_content_length_before_read():
    # GHSA-v9pg-7xvm-68hf: a tiny body records the read boundary, no large payload.
    stream = ReadAudit(b"note=synthetic")
    headers = {
        "Content-Type": b"application/x-www-form-urlencoded",
        "Content-Length": b"-1",
    }
    with pytest.raises(ValueError):
        parse_form(headers, stream, lambda field: None, lambda upload: None)
    assert stream.read_sizes == []


def test_multipart_parses_valid_synthetic_field():
    body = (
        b"--golf-boundary\r\n"
        b'Content-Disposition: form-data; name="note"\r\n\r\n'
        b"synthetic\r\n--golf-boundary--\r\n"
    )
    fields = []
    parse_form(
        {
            "Content-Type": b"multipart/form-data; boundary=golf-boundary",
            "Content-Length": str(len(body)).encode(),
        },
        io.BytesIO(body),
        lambda field: fields.append((field.field_name, field.value)),
        lambda upload: pytest.fail("unexpected file in the synthetic field fixture"),
    )
    assert fields == [(b"note", b"synthetic")]


def test_multipart_rejects_mismatched_boundary():
    parser = MultipartParser(b"golf-boundary")
    with pytest.raises(MultipartParseError):
        parser.write(b"--wrong-boundary\r\n")
