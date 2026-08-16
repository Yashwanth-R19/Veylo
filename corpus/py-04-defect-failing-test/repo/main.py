from fastapi import FastAPI

app = FastAPI()


def multiply(a, b):
    return a * b


@app.get("/health")
def health():
    return {"status": "ok"}
