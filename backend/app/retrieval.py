import math
import re
from collections import Counter

DOCUMENTS = [
    {
        "title": "Password Reset",
        "content": "Users can reset their password from the login page by selecting Forgot Password. A reset link remains valid for 30 minutes.",
        "keywords": {"password", "reset", "forgot", "login", "link"},
    },
    {
        "title": "Two-Factor Authentication",
        "content": "Two-factor authentication can be enabled from Settings → Security → Two-Factor Authentication. The application currently supports authenticator applications. SMS authentication is not supported.",
        "keywords": {"two", "factor", "2fa", "authentication", "authenticator", "sms", "security"},
    },
    {
        "title": "Subscription Cancellation",
        "content": "Users can cancel a subscription from Settings → Billing → Manage Subscription. The subscription remains active until the end of the current billing period. Refunds are reviewed manually by the billing team and are not guaranteed.",
        "keywords": {"subscription", "cancel", "cancellation", "billing", "refund", "money"},
    },
]

STOP_WORDS = {
    "how", "do", "i", "the", "a", "an", "is", "does", "will", "can", "my",
    "me", "your", "you", "what", "when", "to", "from", "it", "this", "that",
    "and", "or", "be", "get", "for", "please", "could", "would",
}


def _normalize_token(token: str) -> str:
    """Apply a small, deterministic stemmer for common inflections."""
    if len(token) > 5 and token.endswith("ies"):
        return token[:-3] + "y"
    if len(token) > 5 and token.endswith("ing"):
        token = token[:-3]
        if len(token) > 2 and token[-1] == token[-2]:
            token = token[:-1]
    elif len(token) > 4 and token.endswith("ed"):
        token = token[:-2]
        if len(token) > 2 and token[-1] == token[-2]:
            token = token[:-1]
    elif len(token) > 3 and token.endswith("s") and not token.endswith("ss"):
        token = token[:-1]
    return token


def tokenize(text: str) -> list[str]:
    return [
        token
        for raw in re.findall(r"[a-z0-9]+", text.lower())
        if (token := _normalize_token(raw)) not in STOP_WORDS
    ]


def _index_documents():
    indexed = []
    for doc in DOCUMENTS:
        title_tokens = tokenize(doc["title"])
        # Keywords add useful query vocabulary while set union avoids inflating
        # term frequency when a keyword already appears in the document text.
        terms = set(tokenize(doc["title"] + " " + doc["content"]))
        terms.update(_normalize_token(keyword.lower()) for keyword in doc["keywords"])
        indexed.append({"doc": doc, "terms": Counter(terms), "title_terms": set(title_tokens)})
    return indexed


_INDEX = _index_documents()
_DOCUMENT_COUNT = len(_INDEX)
_AVERAGE_LENGTH = sum(sum(item["terms"].values()) for item in _INDEX) / max(1, _DOCUMENT_COUNT)


def _idf(term: str) -> float:
    frequency = sum(term in item["terms"] for item in _INDEX)
    return math.log(1 + (_DOCUMENT_COUNT - frequency + 0.5) / (frequency + 0.5))


def _score(query_terms: list[str], item: dict) -> float:
    terms = item["terms"]
    length = sum(terms.values())
    k1, b = 1.5, 0.75
    total_weight = sum(_idf(term) for term in query_terms) or 1.0
    bm25 = 0.0
    matched_title_terms = set()

    for term in query_terms:
        term_frequency = terms.get(term, 0)
        if not term_frequency:
            continue
        idf = _idf(term)
        denominator = term_frequency + k1 * (1 - b + b * length / max(_AVERAGE_LENGTH, 1))
        bm25 += idf * (term_frequency * (k1 + 1) / denominator)
        if term in item["title_terms"]:
            matched_title_terms.add(term)

    weighted_coverage = bm25 / total_weight
    title_coverage = len(matched_title_terms) / max(1, len(set(query_terms)))
    return 0.85 * weighted_coverage + 0.15 * title_coverage


def retrieve(query: str, threshold: float = 0.12, limit: int = 2) -> list[dict]:
    return [item["document"] for item in retrieve_scored(query, threshold, limit)]


def retrieve_scored(query: str, threshold: float = 0.12, limit: int = 2) -> list[dict]:
    """Return ranked documents with normalized relevance and exact evidence text."""
    query_terms = tokenize(query)
    if not query_terms or limit <= 0:
        return []

    ranked = [(_score(query_terms, item), item["doc"]) for item in _INDEX]
    ranked = [(score, doc) for score, doc in ranked if score >= threshold]
    ranked.sort(key=lambda result: result[0], reverse=True)
    return [
        {"title": doc["title"], "passage": doc["content"], "relevance": round(min(score, 1.0), 4), "document": doc}
        for score, doc in ranked[:limit]
    ]
