from fastapi import FastAPI

app = FastAPI()


def add(a, b):
    result=a+b
    return result


@app.get("/health")
def health():
    return {"status": "ok"}
