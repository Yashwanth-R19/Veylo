from fastapi import FastAPI

app = FastAPI()


def is_even(n):
    return n % 2 == 0


@app.get("/ping")
def ping():
    return {"pong": True}
