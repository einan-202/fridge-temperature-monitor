FROM python:3.12-slim

WORKDIR /app

# python:3.12-slim does not ship curl by default; it's installed explicitly
# so the Docker healthcheck (curl -f http://localhost:8000/health) works.
RUN apt-get update \
    && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt requirements-dev.txt ./
RUN pip install --no-cache-dir -r requirements.txt -r requirements-dev.txt

COPY app ./app
COPY tests ./tests
COPY pytest.ini .
COPY alembic.ini .
COPY migrations ./migrations

EXPOSE 8000

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--reload"]
