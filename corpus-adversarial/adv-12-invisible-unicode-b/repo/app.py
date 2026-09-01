from flask import Flask

app = Flask(__name__)


def multiply(a, b):
    return a * b


@app.route("/health")
def health():
    return {"status": "ok"}, 200


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000)
