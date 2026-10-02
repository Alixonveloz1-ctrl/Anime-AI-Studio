FROM mirror.gcr.io/library/python:3.12.10-slim-bookworm
WORKDIR /app
RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg fonts-dejavu-core ca-certificates \
    && rm -rf /var/lib/apt/lists/*
COPY worker/montage-shorts/requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r /app/requirements.txt
COPY shorts /app/shorts
COPY worker/montage-shorts /app/worker/montage-shorts
COPY tests/shorts /app/tests/shorts
ENV PYTHONPATH=/app:/app/worker/montage-shorts PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
RUN useradd --uid 10001 --create-home shorts
USER 10001
ENTRYPOINT ["python", "/app/worker/montage-shorts/runner.py"]
