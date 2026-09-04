"""RAG共享基础设施：Chroma向量库 + 多语言embedding模型加载。

FAQ问答和字幕问答（项目一、项目二）两个RAG功能共用同一套基础设施，靠每条记录的
metadata里的 "type" 字段（"faq" | "subtitle"）区分数据来源，检索时按 type 过滤，
不会互相串。具体的system prompt、LCEL链路这些业务逻辑不在这个文件里，那些是
faq.py（FAQ问答）和summarizer.py（字幕问答）各自的事，这里只管"存进去"和"查出来"。

embedding模型选的是 paraphrase-multilingual-MiniLM-L12-v2（sentence-transformers
家族，支持50+语言），不是纯英文的all-MiniLM-L6-v2——网站是中/英/葡三语，FAQ和字幕都
可能是这三种语言中的任意一种，需要模型本身对这三种语言的语义理解都过关（不是要跨语言
互相匹配，FAQ检索按方案A是同语言内部检索，但字幕本身可能是任意一种语言，模型要都识别得准）。
"""

import os

import chromadb
from sentence_transformers import SentenceTransformer

EMBEDDING_MODEL_NAME = "paraphrase-multilingual-MiniLM-L12-v2"
CHROMA_PERSIST_DIR = os.path.join(os.path.dirname(__file__), "chroma_data")
COLLECTION_NAME = "rag_documents"

# 两个都是重对象（模型加载到内存、数据库连接建立），模块级单例，
# 不要每次调用都重新建一个——参考 summarizer.py 里 VideoSummarizer 的懒加载写法
_model: SentenceTransformer | None = None
_collection = None


def get_embedding_model() -> SentenceTransformer:
    global _model
    if _model is None:
        _model = SentenceTransformer(EMBEDDING_MODEL_NAME)
    return _model


def get_embedding(text: str) -> list[float]:
    """把一段文本变成向量。normalize_embeddings=True 把向量长度归一化成1，
    这样 Chroma 默认用的余弦相似度计算更稳定（不会被文本长度影响向量的模长）"""
    model = get_embedding_model()
    return model.encode(text, normalize_embeddings=True).tolist()


def get_collection():
    """Chroma集合是懒加载的单例，PersistentClient 指向本地文件目录，
    进程重启后数据还在（不是每次启动都要重新灌数据）"""
    global _collection
    if _collection is None:
        client = chromadb.PersistentClient(path=CHROMA_PERSIST_DIR)
        _collection = client.get_or_create_collection(name=COLLECTION_NAME)
    return _collection


def add_documents(ids: list[str], texts: list[str], metadatas: list[dict]) -> None:
    """批量写入/更新（upsert：id已存在就覆盖，不存在就新建，方便FAQ内容更新后重新灌一遍
    不用先手动删旧数据）。每个metadata字典必须带 "type" 字段（"faq" 或 "subtitle"），
    subtitle类型还应该带 video_id/start_time/end_time，供检索时过滤和展示时间点用"""
    if not ids:
        return
    collection = get_collection()
    embeddings = [get_embedding(t) for t in texts]
    collection.upsert(ids=ids, embeddings=embeddings, documents=texts, metadatas=metadatas)


def query(text: str, doc_type: str, top_k: int = 3, extra_where: dict | None = None) -> list[dict]:
    """按语义相似度查最相关的几条，先按 type 过滤（不会查到 faq 和 subtitle 混在一起的结果），
    extra_where 用来加更细的过滤条件（比如字幕RAG按 video_id 只查同一个视频的内容，避免
    跨视频检索到不相关的片段）。返回结果按相似度从高到低排列"""
    collection = get_collection()
    where: dict = {"type": doc_type}
    if extra_where:
        where = {"$and": [where, extra_where]}

    embedding = get_embedding(text)
    results = collection.query(query_embeddings=[embedding], n_results=top_k, where=where)

    documents = results.get("documents") or [[]]
    metadatas = results.get("metadatas") or [[]]
    distances = results.get("distances") or [[]]
    ids = results.get("ids") or [[]]

    return [
        {"id": doc_id, "text": doc, "metadata": meta, "distance": dist}
        for doc_id, doc, meta, dist in zip(ids[0], documents[0], metadatas[0], distances[0])
    ]


def delete_by_where(where: dict) -> None:
    """按条件删除（比如字幕重新提取后，先删掉这个video_id的旧向量再重新写入，
    避免旧内容和新内容混在一起被检索到）"""
    collection = get_collection()
    collection.delete(where=where)


def is_healthy() -> bool:
    """探活用：Chroma的持久化索引文件有可能损坏（比如进程异常崩溃、正好卡在写入索引
    的中途），损坏后连最基础的count()都会抛异常。这里不假设"没报错就是好的"，是真的
    执行一次操作确认。给main.py启动时探活用，配合reset_storage()做自愈"""
    try:
        get_collection().count()
        return True
    except Exception:
        return False


def reset_storage() -> None:
    """清空整个持久化目录，重新开始。Chroma里存的数据全部是从别处能重新算出来的
    派生数据（FAQ来自faq_data/*.json，字幕来自SubtitleSegment表），不是唯一保存的
    原始数据，坏了直接推倒重建，比试图修复损坏的索引文件靠谱。调用方需要在这之后
    自己把数据重新灌回去（faq.load_faq_into_chroma() + 字幕这边的重建函数）"""
    global _collection
    import shutil
    _collection = None
    if os.path.exists(CHROMA_PERSIST_DIR):
        shutil.rmtree(CHROMA_PERSIST_DIR, ignore_errors=True)
