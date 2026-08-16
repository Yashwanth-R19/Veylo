from fastapi import FastAPI

app = FastAPI()


def square(n):
    return n * n


@app.get("/health")
def health():
    return {"status": "ok"}
