web: gunicorn wsgi:app --bind 0.0.0.0:$PORT --workers 4 --timeout 120
worker: celery -A app.celery worker --loglevel=info
