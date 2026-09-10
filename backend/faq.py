"""FAQ智能问答模块（QA agent）：FAQ数据灌入Chroma + LangChain LCEL问答链路

跟字幕问答（summarizer.py）复用同一个OpenRouter账号、同一套rag.py检索基础设施，
区别是这里用LangChain的LCEL写法接LLM（字幕问答那边是openai库直连），是有意的技术选型，
两种写法在这个项目里都保留作为参考，不是谁取代谁。
"""

import json
import os

from langchain_core.messages import HumanMessage, SystemMessage
from langchain_core.runnables import RunnableLambda
from langchain_openai import ChatOpenAI

import rag
from summarizer import VideoSummarizer, _looks_like_valid_reply

FAQ_DOC_TYPE = "faq"
FAQ_LANGUAGES = ["zh", "en", "pt"]
FAQ_DATA_DIR = os.path.join(os.path.dirname(__file__), "faq_data")

# top_k=2：FAQ每条内容单一、颗粒度细（一条只答一个具体问题），2条足够覆盖"主答案+备选"，
# 选太大反而容易把不相关的FAQ也塞进context，稀释LLM对真正命中那条的关注度
FAQ_TOP_K = 2


def load_faq_into_chroma() -> int:
    """把三语言FAQ JSON文件的内容灌入Chroma，返回本次写入的条目总数。

    embedding的是question文本（不是answer）——用户提问的措辞更接近FAQ的问题句，
    这样检索命中率更高；answer直接存进metadata，检索时不用再回头查JSON文件。
    用的是rag.add_documents的upsert语义，同一条FAQ重复灌入不会产生重复条目，
    会直接覆盖旧内容（前提是id不变，见下面id拼接规则）。
    """
    ids: list[str] = []
    texts: list[str] = []
    metadatas: list[dict] = []

    for lang in FAQ_LANGUAGES:
        path = os.path.join(FAQ_DATA_DIR, f"faq_{lang}.json")
        with open(path, "r", encoding="utf-8") as f:
            items = json.load(f)

        for item in items:
            # 三语言里同一条FAQ的id是一样的（比如都叫faq_001），但Chroma不允许id跨条目
            # 重复，所以实际写入时加语言前缀区分（zh_faq_001/en_faq_001/pt_faq_001），
            # 避免三语言的内容互相覆盖
            ids.append(f"{lang}_{item['id']}")
            texts.append(item["question"])
            metadatas.append({
                "type": FAQ_DOC_TYPE,
                "language": lang,
                "category": item["category"],
                "answer": item["answer"],
            })

    rag.add_documents(ids, texts, metadatas)
    return len(ids)


def build_faq_system_prompt(is_first_turn: bool) -> str:
    base = (
        "你是本网站（AI Video Downloader）的客服助手QA agent，基于网站FAQ知识库回答用户"
        "关于产品功能、计费、使用方式等问题。只根据检索到的FAQ内容作答，不要编造网站没有的"
        "功能、政策或数字。如果检索到的内容不足以回答用户问题，诚实告知用户你不确定，不要猜测。"
    )
    if is_first_turn:
        base += (
            "\n\n这是对话的第一条消息，请先用一句话自我介绍："
            "\"你好，我是QA agent，可以帮你解答网站功能、计费、使用方法相关的问题。\""
            "然后再回答用户实际的问题（如果有的话）。"
        )
    return base


def _format_context(results: list[dict]) -> str:
    """把rag.query()返回的检索结果拼成LLM能读的纯文本context，每条是"Q+A"配对
    （而不是只给A），让LLM能看到原始问题措辞，判断检索到的内容是否真的匹配用户问题"""
    if not results:
        return "（未检索到相关FAQ内容）"
    return "\n\n".join(
        f"Q: {r['text']}\nA: {r['metadata']['answer']}" for r in results
    )


def _retrieve_and_build_messages(input_data: dict) -> list:
    """LCEL链路里的RunnableLambda这一步：检索FAQ + 按is_first_turn动态选system prompt变体，
    组装成LangChain消息列表。必须写成运行时函数，不能用LangChain的静态PromptTemplate——
    is_first_turn是请求参数，只有真正调用链路的这一刻才知道该塞开场白版本还是普通版本"""
    question = input_data["question"]
    language = input_data["language"]
    is_first_turn = input_data["is_first_turn"]

    results = rag.query(
        question, doc_type=FAQ_DOC_TYPE, top_k=FAQ_TOP_K, extra_where={"language": language}
    )
    context = _format_context(results)

    system_prompt = build_faq_system_prompt(is_first_turn)
    user_message = f"以下是从FAQ知识库检索到的相关内容：\n\n{context}\n\n---\n用户问题：{question}"

    return [SystemMessage(content=system_prompt), HumanMessage(content=user_message)]


_llm: ChatOpenAI | None = None


def _get_llm() -> ChatOpenAI:
    """LangChain的ChatOpenAI，接的还是OpenRouter那个endpoint、同一个API key，
    只是换了SDK；沿用summarizer.py里VideoSummarizer.FALLBACK_MODELS的故障转移列表
    （extra_body的models数组，OpenRouter服务端自动在列表内切换可用的免费模型），
    不重新维护一份一样的配置。懒加载单例，避免每次请求都重新建一个客户端对象"""
    global _llm
    if _llm is None:
        api_key = os.getenv("OPENROUTER_API_KEY", "").strip()
        if not api_key:
            raise ValueError("OPENROUTER_API_KEY 环境变量未设置")
        _llm = ChatOpenAI(
            model=VideoSummarizer.FALLBACK_MODELS[0],
            api_key=api_key,
            base_url="https://openrouter.ai/api/v1",
            streaming=True,
            max_retries=2,
            temperature=0.3,
            max_tokens=1024,
            extra_body={"models": VideoSummarizer.FALLBACK_MODELS},
            default_headers={
                "HTTP-Referer": "http://localhost:5173",
                "X-Title": "Universal Video Downloader",
            },
        )
    return _llm


def faq_chat_stream(question: str, language: str, is_first_turn: bool):
    """FAQ问答主入口，yield完整回复（不是逐token流式）。

    链路：{question, language, is_first_turn}
      → RunnableLambda（检索FAQ + 选system prompt + 组装消息列表，见_retrieve_and_build_messages）
      → ChatOpenAI（调用OpenRouter，内部走LangChain的.stream()拿到完整回复后再一次性yield出去）

    不是真的逐token流式：FALLBACK_MODELS第一位是"openrouter/free"自动路由（见
    summarizer.py注释），实测过会被误路由到内容审核类模型、返回"User Safety: safe"
    这种分类标签而不是真的在回答问题。FAQ回复通常短，先攒完整内容校验一遍
    （_looks_like_valid_reply）不像正常回复就换个模型重试，比直接把分类标签展示给用户强，
    用户感知的延迟差异很小
    """
    chain = RunnableLambda(_retrieve_and_build_messages) | _get_llm()
    payload = {"question": question, "language": language, "is_first_turn": is_first_turn}

    full_reply = ""
    for attempt in range(2):
        full_reply = "".join(chunk.content or "" for chunk in chain.stream(payload))
        if _looks_like_valid_reply(full_reply):
            break
    yield full_reply


if __name__ == "__main__":
    count = load_faq_into_chroma()
    print(f"已写入 {count} 条FAQ记录到Chroma")
