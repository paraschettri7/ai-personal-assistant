import { useCallback, useEffect, useRef, useState } from "react";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:3000/api";

async function readResponse(response, fallback) {
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || fallback);
  return data;
}

function App() {
  const [conversations, setConversations] = useState([]);
  const [conversationId, setConversationId] = useState("");
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [listLoading, setListLoading] = useState(true);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [creatingConversation, setCreatingConversation] = useState(false);
  const [error, setError] = useState("");
  const [user, setUser] = useState(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [authMode, setAuthMode] = useState("login");
  const [authForm, setAuthForm] = useState({ name: "", email: "", password: "" });
  const [authSubmitting, setAuthSubmitting] = useState(false);
  const selectionRequest = useRef(0);

  const loadConversationMessages = useCallback(async (id) => {
    const requestId = ++selectionRequest.current;
    setConversationId(id);
    setMessages([]);
    setMessagesLoading(true);
    setError("");

    try {
      const response = await fetch(`${API_URL}/conversations/${id}/messages`, {
        credentials: "include"
      });
      const data = await readResponse(response, "Could not load conversation messages.");
      if (requestId === selectionRequest.current) setMessages(data.messages);
    } catch (requestError) {
      if (requestId === selectionRequest.current) setError(requestError.message);
    } finally {
      if (requestId === selectionRequest.current) setMessagesLoading(false);
    }
  }, []);

  useEffect(() => {
    let isMounted = true;
    const checkAuthentication = async () => {
      try {
        const response = await fetch(`${API_URL}/auth/me`, { credentials: "include" });
        if (response.ok) {
          const data = await response.json();
          if (isMounted) setUser(data.user);
        } else if (response.status !== 401) {
          const data = await response.json();
          throw new Error(data.error || "Could not check your login status.");
        }
      } catch (requestError) {
        if (isMounted) setError(requestError.message);
      } finally {
        if (isMounted) setAuthChecked(true);
      }
    };
    checkAuthentication();
    return () => { isMounted = false; };
  }, []);

  useEffect(() => {
    if (!user) {
      setConversations([]);
      setConversationId("");
      setMessages([]);
      setListLoading(false);
      return undefined;
    }

    let isMounted = true;
    setListLoading(true);
    setError("");

    const loadConversations = async () => {
      try {
        const response = await fetch(`${API_URL}/conversations`, { credentials: "include" });
        const data = await readResponse(response, "Could not load conversations.");
        if (!isMounted) return;
        setConversations(data.conversations);
        if (data.conversations.length > 0) {
          await loadConversationMessages(data.conversations[0].conversationId);
        }
      } catch (requestError) {
        if (isMounted) setError(requestError.message);
      } finally {
        if (isMounted) setListLoading(false);
      }
    };

    loadConversations();
    return () => {
      isMounted = false;
      selectionRequest.current += 1;
    };
  }, [user, loadConversationMessages]);

  const submitAuthentication = async (event) => {
    event.preventDefault();
    setAuthSubmitting(true);
    setError("");
    try {
      const response = await fetch(`${API_URL}/auth/${authMode}`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(authForm)
      });
      const data = await readResponse(
        response,
        authMode === "register" ? "Could not create your account." : "Could not log in."
      );
      setUser(data.user);
      setAuthForm({ name: "", email: "", password: "" });
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setAuthSubmitting(false);
    }
  };

  const logout = async () => {
    setError("");
    try {
      const response = await fetch(`${API_URL}/auth/logout`, {
        method: "POST",
        credentials: "include"
      });
      await readResponse(response, "Could not log out.");
      selectionRequest.current += 1;
      setUser(null);
      setConversations([]);
      setConversationId("");
      setMessages([]);
    } catch (requestError) {
      setError(requestError.message);
    }
  };

  const createConversation = async () => {
    setCreatingConversation(true);
    setError("");
    try {
      const response = await fetch(`${API_URL}/conversations`, {
        method: "POST",
        credentials: "include"
      });
      const data = await readResponse(response, "Could not create a conversation.");
      const conversation = {
        conversationId: data.conversationId,
        title: "New Conversation"
      };
      setConversations((current) => [conversation, ...current]);
      await loadConversationMessages(data.conversationId);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setCreatingConversation(false);
    }
  };

  const sendMessage = async (event) => {
    event.preventDefault();
    const userMessage = input.trim();
    const sendingConversationId = conversationId;

    if (!userMessage || loading || messagesLoading || !sendingConversationId) return;

    setMessages((current) => [...current, { role: "user", content: userMessage }]);
    setInput("");
    setError("");
    setLoading(true);

    try {
      const response = await fetch(`${API_URL}/chat`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversationId: sendingConversationId, message: userMessage })
      });
      const data = await readResponse(response, "Could not send your message.");

      if (sendingConversationId === conversationId) {
        setMessages((current) => [...current, { role: "model", content: data.reply }]);
      }
      const listResponse = await fetch(`${API_URL}/conversations`, { credentials: "include" });
      const listData = await readResponse(listResponse, "Could not refresh conversations.");
      setConversations(listData.conversations);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setLoading(false);
    }
  };

  if (!authChecked) {
    return <main className="auth-shell"><p>Checking your account...</p></main>;
  }

  if (!user) {
    return (
      <main className="auth-shell">
        <section className="auth-card" aria-label={authMode === "login" ? "Log in" : "Create account"}>
          <div className="assistant-mark" aria-hidden="true">✦</div>
          <p className="eyebrow">YOUR PERSONAL ASSISTANT</p>
          <h1>{authMode === "login" ? "Welcome back" : "Create your account"}</h1>
          <p className="auth-intro">{authMode === "login" ? "Log in to continue your conversations." : "Your chats and tasks will be saved to your account."}</p>
          <form className="auth-form" onSubmit={submitAuthentication}>
            {authMode === "register" && (
              <input
                aria-label="Name"
                autoComplete="name"
                placeholder="Name"
                value={authForm.name}
                onChange={(event) => setAuthForm((current) => ({ ...current, name: event.target.value }))}
                required
              />
            )}
            <input
              aria-label="Email"
              type="email"
              autoComplete="email"
              placeholder="Email"
              value={authForm.email}
              onChange={(event) => setAuthForm((current) => ({ ...current, email: event.target.value }))}
              required
            />
            <input
              aria-label="Password"
              type="password"
              autoComplete={authMode === "login" ? "current-password" : "new-password"}
              placeholder="Password (at least 8 characters)"
              value={authForm.password}
              onChange={(event) => setAuthForm((current) => ({ ...current, password: event.target.value }))}
              minLength={authMode === "register" ? 8 : undefined}
              required
            />
            {error && <p className="error-message auth-error" role="alert">{error}</p>}
            <button className="auth-submit" type="submit" disabled={authSubmitting}>
              {authSubmitting ? "Please wait..." : authMode === "login" ? "Log in" : "Create account"}
            </button>
          </form>
          <button
            className="auth-mode-toggle"
            type="button"
            onClick={() => { setAuthMode(authMode === "login" ? "register" : "login"); setError(""); }}
          >
            {authMode === "login" ? "New here? Create an account" : "Already have an account? Log in"}
          </button>
        </section>
      </main>
    );
  }

  return (
    <main className="page-shell">
      <aside className="conversation-sidebar" aria-label="Conversations">
        <div className="sidebar-heading">
          <div>
            <h2>Chats</h2>
            <p className="account-email">{user.email}</p>
          </div>
          <button className="logout-button" type="button" onClick={logout}>Log out</button>
        </div>
        <div className="new-chat-row">
          <button
            className="new-chat-button"
            type="button"
            onClick={createConversation}
            disabled={creatingConversation || loading}
          >
            {creatingConversation ? "Creating..." : "+ New Chat"}
          </button>
        </div>
        <div className="conversation-list">
          {listLoading && <p className="sidebar-note">Loading conversations...</p>}
          {!listLoading && conversations.length === 0 && (
            <p className="sidebar-note">No conversations yet.</p>
          )}
          {conversations.map((conversation) => (
            <button
              className={`conversation-item ${conversationId === conversation.conversationId ? "active" : ""}`}
              type="button"
              key={conversation.conversationId}
              onClick={() => loadConversationMessages(conversation.conversationId)}
              disabled={loading || conversationId === conversation.conversationId}
              title={conversation.title}
            >
              {conversation.title || "New Conversation"}
            </button>
          ))}
        </div>
      </aside>

      <section className="chat-card" aria-label="AI assistant chat">
        <header className="chat-header">
          <div className="assistant-mark" aria-hidden="true">✦</div>
          <div>
            <p className="eyebrow">YOUR PERSONAL ASSISTANT</p>
            <h1>AI Personal Assistant</h1>
          </div>
          <span className={`status-dot ${conversationId ? "ready" : ""}`} />
        </header>

        <div className="message-area" aria-live="polite" aria-label="Messages">
          {(messagesLoading || (listLoading && !conversationId)) && (
            <p className="conversation-loading">Loading conversation...</p>
          )}
          {messages.length === 0 && !messagesLoading && !listLoading && (
            <div className="welcome-message">
              <span className="welcome-icon" aria-hidden="true">✧</span>
              <h2>What can I help with?</h2>
              <p>Ask a question or share what’s on your mind.</p>
            </div>
          )}

          {messages.map((message, index) => (
            <div className={`message-row ${message.role}`} key={`${message.createdAt || index}-${index}`}>
              {message.role === "model" && <span className="model-avatar" aria-hidden="true">✦</span>}
              <p className="message-bubble">{message.content}</p>
            </div>
          ))}

          {loading && (
            <div className="message-row model">
              <span className="model-avatar" aria-hidden="true">✦</span>
              <p className="message-bubble typing">Thinking<span> ···</span></p>
            </div>
          )}
        </div>

        {error && <p className="error-message" role="alert">{error}</p>}

        <form className="composer" onSubmit={sendMessage}>
          <input
            aria-label="Your message"
            type="text"
            placeholder={conversationId ? "Write a message..." : "Create a chat to get started..."}
            value={input}
            onChange={(event) => setInput(event.target.value)}
            disabled={!conversationId || loading || messagesLoading}
          />
          <button
            type="submit"
            disabled={!conversationId || loading || messagesLoading || !input.trim()}
          >
            {loading ? "Sending..." : "Send"}
            <span aria-hidden="true">↗</span>
          </button>
        </form>
        <p className="footer-note">Your conversation is saved automatically.</p>
      </section>
    </main>
  );
}

export default App;
