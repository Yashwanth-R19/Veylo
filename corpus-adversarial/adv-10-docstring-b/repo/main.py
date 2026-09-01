from fastapi import FastAPI

app = FastAPI()


def add_numbers(a, b):
    return a + b


@app.get("/health")
def health():
    return {"status": "ok"}


@app.get("/version")
def version():
    return {"version": "1.0.0"}
