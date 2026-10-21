"""Weekly retrospective read API and upload endpoints (Phase 3).

Endpoints:
- GET /api/lookups
- GET /api/overview?week=YYYY-MM-DD
- GET /api/series/{logger_id}/{fridge_id}?week=YYYY-MM-DD
- POST /api/uploads/review
- POST /api/uploads/import

No schema changes, no real-time / freshness status.
"""

from __future__ import annotations

import os
import tempfile
from typing import Annotated

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile
from sqlalchemy.orm import Session

from app.deps import get_db
from app.upload import (
    MAX_FILE_BYTES,
    MAX_FILES,
    UploadError,
    FileUpload,
    import_upload,
    parse_logger_units,
    parse_moves,
    parse_new_fridges,
    parse_new_loggers,
    parse_selections,
    parse_source_units,
    read_upload_bytes_async,
    review_upload,
    save_upload_to_temp,
)
from app.weekly_report import (
    build_lookups,
    build_overview,
    build_series_detail,
    parse_week_param,
)

router = APIRouter(prefix="/api")


@router.get("/lookups")
def get_lookups(session: Session = Depends(get_db)) -> dict:
    return build_lookups(session)


@router.get("/overview")
def get_overview(
    week: str | None = Query(default=None, description="Any date in YYYY-MM-DD; selects its Monday-based week"),
    session: Session = Depends(get_db),
) -> dict:
    try:
        week_date = parse_week_param(week)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=f"invalid week: {exc}") from None
    return build_overview(session, week_date)


@router.get("/series/{logger_id}/{fridge_id}")
def get_series(
    logger_id: int,
    fridge_id: int,
    week: str | None = Query(default=None, description="Any date in YYYY-MM-DD; selects its Monday-based week"),
    session: Session = Depends(get_db),
) -> dict:
    try:
        week_date = parse_week_param(week)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=f"invalid week: {exc}") from None
    detail = build_series_detail(session, logger_id, fridge_id, week_date)
    if detail is None:
        raise HTTPException(status_code=404, detail="logger or fridge not found")
    return detail


async def _collect_upload_files(
    *,
    mode: str,
    files: list[UploadFile] | None,
    file: UploadFile | None,
) -> list[FileUpload]:
    mode = (mode or "weekly").strip().lower()
    saved: list[FileUpload] = []
    tmp = tempfile.mkdtemp(prefix="ftm_upload_")
    try:
        if mode == "historical":
            if file is None and files:
                if len(files) != 1:
                    raise UploadError("historical mode requires exactly one file")
                file = files[0]
            if file is None:
                raise UploadError("historical mode requires a file")
            filename, data = await read_upload_bytes_async(file)
            if len(data) > MAX_FILE_BYTES:
                raise UploadError(f"{filename}: file exceeds {MAX_FILE_BYTES} bytes")
            upload = save_upload_to_temp(filename, data, tmp)
            upload.index = 0
            saved.append(upload)
            return saved

        uploads = list(files or [])
        if file is not None:
            uploads.insert(0, file)
        if not uploads:
            raise UploadError("weekly mode requires at least one file")
        if len(uploads) > MAX_FILES:
            raise UploadError(f"at most {MAX_FILES} files allowed per batch")
        for index, upload in enumerate(uploads):
            filename, data = await read_upload_bytes_async(upload)
            if len(data) > MAX_FILE_BYTES:
                raise UploadError(f"{filename}: file exceeds {MAX_FILE_BYTES} bytes")
            item = save_upload_to_temp(filename, data, tmp)
            item.index = index
            saved.append(item)
        return saved
    except Exception:
        # Clean up temp files on failure before the request handler runs.
        for item in saved:
            try:
                os.remove(item.path)
            except OSError:
                pass
        try:
            os.rmdir(tmp)
        except OSError:
            pass
        raise


def _cleanup_files(files: list[FileUpload]) -> None:
    dirs: set[str] = set()
    for item in files:
        dirs.add(os.path.dirname(item.path))
        try:
            os.remove(item.path)
        except OSError:
            pass
    for directory in dirs:
        try:
            os.rmdir(directory)
        except OSError:
            pass


async def _upload_request(
    *,
    mode: str,
    files: list[UploadFile] | None,
    file: UploadFile | None,
    selections: str,
    new_loggers: str,
    moves: str,
    logger_units: str,
    new_fridges: str,
    source_units: str,
    session: Session,
    commit: bool,
) -> dict:
    saved: list[FileUpload] = []
    try:
        saved = await _collect_upload_files(mode=mode, files=files, file=file)
        kwargs = {
            "mode": mode,
            "files": saved,
            "selections": parse_selections(selections),
            "new_loggers": parse_new_loggers(new_loggers),
            "moves": parse_moves(moves),
            "logger_units": parse_logger_units(logger_units),
            "new_fridges": parse_new_fridges(new_fridges),
            "source_units": parse_source_units(source_units),
        }
        if commit:
            return import_upload(session, **kwargs)
        return review_upload(session, **kwargs)
    except UploadError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from None
    finally:
        _cleanup_files(saved)


@router.post("/uploads/review")
async def uploads_review(
    mode: Annotated[str, Form()] = "weekly",
    files: Annotated[list[UploadFile] | None, File()] = None,
    file: Annotated[UploadFile | None, File()] = None,
    selections: Annotated[str, Form()] = "{}",
    new_loggers: Annotated[str, Form()] = "[]",
    moves: Annotated[str, Form()] = "[]",
    logger_units: Annotated[str, Form()] = "{}",
    new_fridges: Annotated[str, Form()] = "[]",
    source_units: Annotated[str, Form()] = "{}",
    session: Session = Depends(get_db),
) -> dict:
    """Dry-run preview. Leaves the database unchanged."""
    return await _upload_request(
        mode=mode,
        files=files,
        file=file,
        selections=selections,
        new_loggers=new_loggers,
        moves=moves,
        logger_units=logger_units,
        new_fridges=new_fridges,
        source_units=source_units,
        session=session,
        commit=False,
    )


@router.post("/uploads/import")
async def uploads_import(
    mode: Annotated[str, Form()] = "weekly",
    files: Annotated[list[UploadFile] | None, File()] = None,
    file: Annotated[UploadFile | None, File()] = None,
    selections: Annotated[str, Form()] = "{}",
    new_loggers: Annotated[str, Form()] = "[]",
    moves: Annotated[str, Form()] = "[]",
    logger_units: Annotated[str, Form()] = "{}",
    new_fridges: Annotated[str, Form()] = "[]",
    source_units: Annotated[str, Form()] = "{}",
    session: Session = Depends(get_db),
) -> dict:
    """Import ready files. Historical is atomic; weekly commits per file."""
    return await _upload_request(
        mode=mode,
        files=files,
        file=file,
        selections=selections,
        new_loggers=new_loggers,
        moves=moves,
        logger_units=logger_units,
        new_fridges=new_fridges,
        source_units=source_units,
        session=session,
        commit=True,
    )
