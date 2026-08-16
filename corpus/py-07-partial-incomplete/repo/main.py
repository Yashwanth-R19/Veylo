from fastapi import FastAPI

app = FastAPI()


def double(n):
    return n * 2


@app.get("/health")
def health():
    return {"status": "ok"}
