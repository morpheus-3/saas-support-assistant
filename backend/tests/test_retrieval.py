from app.retrieval import retrieve

def test_password_reset_retrieves_document():
    assert retrieve("How do I reset my password?")[0]["title"] == "Password Reset"

def test_refund_question_retrieves_cancellation_policy():
    assert retrieve("Will I receive a refund when I cancel?")[0]["title"] == "Subscription Cancellation"

def test_account_export_is_not_found():
    assert retrieve("How do I export my account data?") == []

def test_password_query_matches_common_word_forms():
    assert retrieve("I forgot my passwords")[0]["title"] == "Password Reset"

def test_ranked_results_return_best_matches_first():
    results = retrieve("reset my password and cancel subscription")
    assert [doc["title"] for doc in results] == ["Password Reset", "Subscription Cancellation"]

def test_retrieval_limit_can_be_configured():
    assert len(retrieve("password reset and subscription cancellation", limit=1)) == 1

def test_empty_or_stop_word_only_queries_return_no_results():
    assert retrieve("") == []
    assert retrieve("how do I") == []
