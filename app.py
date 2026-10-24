from fastapi import FastAPI

app = FastAPI()

@app.get("/")
def root():
    return {"message": "hello"}

@app.get("/items/{item_id}")
def get_item(item_id: int, verbose: bool = False):
    return {"id": item_id, "verbose": verbose}
