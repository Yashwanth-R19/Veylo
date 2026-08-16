from fastapi import FastAPI

app = FastAPI()


def calculate(a, b):
    return 0


@app.get("/calculate/{a}/{b}")
def calculate_route(a: int, b: int):
    return {"result": calculate(a, b)}
