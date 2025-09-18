import React, { useState } from "react";
import { ToastContainer, toast } from "react-toastify";
import "react-toastify/dist/ReactToastify.css";

// const API = (path, opts={}) => fetch((process.env.API_BASE || 'http://localhost:5000') + path, opts).then(r=>r.json());
const API_BASE = import.meta.env.VITE_API_BASE;
const API = (path, opts = {}) =>
  fetch(API_BASE + path, opts).then((r) => r.json());

export default function App() {
  const [project, setProject] = useState(null);
  const [transcript, setTranscript] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [sources, setSources] = useState([]);
  const [candidateKps, setCandidateKps] = useState([]);
  const [approvedKps, setApprovedKps] = useState([]);
  const [direction, setDirection] = useState({
    tone: "neutral",
    length: "medium",
  });
  const [draft, setDraft] = useState(null);
  const [quoteMatches, setQuoteMatches] = useState([]);
  const [loading, setLoading] = useState(false);

  const toastOptions = {
    position: "top-right",
    autoClose: 6000,
    pauseOnHover: true,
    draggable: true,
    theme: "dark",
  };

  async function createProject() {
    const res = await API("/api/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Demo Project" }),
    });
    setProject(res);
  }

  async function uploadTranscript() {
    try {
      if (!project) return toast.error("create project first", toastOptions);
      setLoading(true);
      await API(`/api/projects/${project.id}/transcript`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ transcript }),
      });
      setLoading(false);
      toast.success("transcript saved", toastOptions);
    } catch (error) {
      toast.error("transcript not saved", toastOptions);
    }
  }

  async function addSource() {
    if (!project) return toast.error("create project first");
    setLoading(true);
    try {
      const res = await API(`/api/projects/${project.id}/sources`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: sourceUrl }),
    });
    setLoading(false);
    setSourceUrl("");
    setSources((prev) => [...prev, res]);
    } catch (error) {
      console.error("Source addition failed:", error);
      setLoading(false);
      toast.error("Source addition failed", toastOptions);
    }
    
  }

  async function extractKps() {
    if (!project) return toast.error("create project first");
    setLoading(true);
    try {
      const res = await API(`/api/projects/${project.id}/extract-keypoints`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    setLoading(false);
    setCandidateKps(res.candidateKeypoints || []);
    } catch (error) {
      console.error("Key points extraction failed:", error);
      setLoading(false);
      toast.error("Key points extraction failed", toastOptions);
    }
    
  }

  function addToApproved(kp) {
    setApprovedKps((prev) => [...prev, kp]);
  }

  function removeApproved(idx) {
    setApprovedKps((prev) => prev.filter((_, i) => i !== idx));
  }

  function moveApproved(idx, dir) {
    setApprovedKps((prev) => {
      const arr = [...prev];
      const t = arr[idx];
      arr.splice(idx, 1);
      arr.splice(idx + dir, 0, t);
      return arr;
    });
  }

  async function saveApproved() {
    if (!project) return toast.error("create project first");
    setLoading(true);
    try {
      await API(`/api/projects/${project.id}/approve-keypoints`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ approved: approvedKps.map((k) => k.text) }),
    });
    setLoading(false);
    // alert('approved saved');
    toast.success("transcript approved saved", toastOptions);
    } catch (error) {
      console.error("Approved key points save failed:", error);
      toast.error("Approved key points save failed", toastOptions);
    }
    
  }

  async function generateDraft() {
    if (!project) return toast.error("create project first");
    setLoading(true);
    try {
      const res = await API(`/api/projects/${project.id}/generate-draft`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ direction }),
    });
    setLoading(false);
    setDraft(res.draft);
    setQuoteMatches(res.quoteMatches || []);
    // fetch sources list for local UI
    const p = await API(`/api/projects/${project.id}`);
    // this demo backend doesn't have GET /api/projects/:id content endpoint, we kept sources locally
    } catch (error) {
      console.error("Draft generation failed:", error);
      toast.error("Draft generation failed");
    }
    
  }

  async function runQuoteCheck() {
  if (!project) return toast.error("no project");
  setLoading(true);
  try {
    const res = await API(`/api/projects/${project.id}/quote-check`);
    setQuoteMatches(res.quoteMatches || []);
    // Check your browser's console for this log to see what data you received
    console.log("Quote check response:", res); 
  } catch (error) {
    console.error("Failed to run quote check:", error);
    toast.error("Could not load quote matches.");
  } finally {
    // The 'finally' block ensures loading is set to false whether it succeeds or fails.
    setLoading(false);
  }
}

  async function exportMarkdown() {
    if (!project) return toast.error("no project");
    setLoading(true);
    try {
      const res = await API(`/api/projects/${project.id}/export`);
      setLoading(false);
      const md = res.markdown || "";
      const prov = res.provenance || [];
      // download markdown
      const blob = new Blob([md], { type: "text/markdown" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `${project.id}.md`;
      a.click();
      // download provenance json
      const b2 = new Blob([JSON.stringify(prov, null, 2)], {
        type: "application/json",
      });
      const b2a = document.createElement("a");
      b2a.href = URL.createObjectURL(b2);
      b2a.download = `${project.id}-provenance.json`;
      b2a.click();
    } catch (error) {
      console.error("Export failed:", error);
      toast.error("Export failed");
    }
    
  }

  return (
    <div className="container">
      <h2>ICTA Transcrpit Draft</h2>
      <div className="row">
        <div style={{ flex: 1 }} className="col">
          <div className="panel">
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={createProject}>Create Project</button>
              <div style={{ marginLeft: 10 }}>
                {project ? (
                  <span className="badge">
                    Project: {project.id.slice(0, 8)}
                  </span>
                ) : (
                  <span className="small">No project yet</span>
                )}
              </div>
            </div>
            <hr />
            <div>
              <label>
                <strong>Transcript (paste):</strong>
              </label>
              <textarea
                value={transcript}
                onChange={(e) => setTranscript(e.target.value)}
                placeholder="Paste interview transcript here..."
              />
              <div style={{ display: "flex", gap: 8 }}>
                <button
                  className="small"
                  onClick={uploadTranscript}
                >
                  {loading ? "..." : "Save Transcript"}
                </button>
                <button
                  className="small"
                  onClick={extractKps}
                >
                  {loading ? "..." : "Extract Key Points"}
                </button>
              </div>
            </div>

            <hr />
            <div>
              <label>
                <strong>Add Source (URL):</strong>
              </label>
              <div style={{ display: "flex", gap: 8 }}>
                <input
                  style={{ flex: 1 }}
                  value={sourceUrl}
                  onChange={(e) => setSourceUrl(e.target.value)}
                  placeholder="https://..."
                />
                <button onClick={addSource}>
                  Add
                </button>
              </div>
              <div style={{ marginTop: 8 }}>
                {sources.map((s) => (
                  <div key={s.id} className="kp">
                    {s.title || s.url}{" "}
                    <span
                      style={{ marginLeft: 8, fontSize: 12, color: "#475569" }}
                    >
                      id:{s.id.slice(0, 6)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div style={{ height: 14 }} />

          <div className="panel">
            <h4>Candidate key points</h4>
            {candidateKps.length === 0 ? (
              <div className="small">
                No candidates yet — click "Extract Key Points"
              </div>
            ) : (
              candidateKps.map((k) => (
                <div key={k.id} className="kp">
                  <div style={{ flex: 1 }}>{k.text}</div>
                  <div className="kp-actions">
                    <button className="small" onClick={() => addToApproved(k)}>
                      Approve →
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>

          <div style={{ height: 14 }} />

          <div className="panel">
            <h4>Approved key points (HITL review)</h4>
            <div className="small">
              You can reorder and remove before generating.
            </div>
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 8,
                marginTop: 8,
              }}
            >
              {approvedKps.map((k, idx) => (
                <div key={idx} className="kp">
                  <input
                    value={k.text}
                    onChange={(e) =>
                      setApprovedKps((prev) => {
                        const arr = [...prev];
                        arr[idx] = { ...arr[idx], text: e.target.value };
                        return arr;
                      })
                    }
                  />
                  <div className="kp-actions">
                    <button
                      className="small"
                      onClick={() => moveApproved(idx, -1)}
                      disabled={idx === 0}
                    >
                      ▲
                    </button>
                    <button
                      className="small"
                      onClick={() => moveApproved(idx, 1)}
                      disabled={idx === approvedKps.length - 1}
                    >
                      ▼
                    </button>
                    <button
                      className="small"
                      onClick={() => removeApproved(idx)}
                    >
                      ✕
                    </button>
                  </div>
                </div>
              ))}
            </div>
            <div style={{ marginTop: 8 }}>
              <button onClick={saveApproved}>
                Save Approved
              </button>
            </div>
          </div>

          <div style={{ height: 14 }} />

          <div className="panel">
            <h4>Direction</h4>
            <div style={{ display: "flex", gap: 8 }}>
              <select
                value={direction.tone}
                onChange={(e) =>
                  setDirection((d) => ({ ...d, tone: e.target.value }))
                }
              >
                <option value="neutral">Neutral</option>
                <option value="optimistic">Optimistic</option>
                <option value="critical">Critical</option>
              </select>
              <select
                value={direction.length}
                onChange={(e) =>
                  setDirection((d) => ({ ...d, length: e.target.value }))
                }
              >
                <option value="short">Short (~300-400 words)</option>
                <option value="medium">Medium (~600-900 words)</option>
                <option value="long">Long (~1200+ words)</option>
              </select>
              <button
                onClick={generateDraft}
              >
                Generate Draft
              </button>
            </div>
          </div>
        </div>

        <div style={{ width: 420 }} className="col">
          <div className="panel">
            <h4>Draft</h4>
            {!draft ? (
              <div className="small">No draft yet</div>
            ) : (
              <div>
                {draft.paragraphs.map((pg) => (
                  <div key={pg.index} className="paragraph">
                    <div
                      dangerouslySetInnerHTML={{
                        __html: pg.text.replace(/\n/g, "<br/>"),
                      }}
                    />
                    <div className="sources">
                      Sources ({pg.sources.length}):{" "}
                      {pg.sources.slice(0, 3).map((s) => (
                        <span key={s.sourceId} style={{ marginRight: 8 }}>
                          {s.sourceId.slice(0, 6)}
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
                <div style={{ display: "flex", gap: 8 }}>
                  <button onClick={runQuoteCheck} className="small">
                    Run Quote Checker
                  </button>
                  <button onClick={exportMarkdown} className="small">
                    Export Markdown + Provenance
                  </button>
                </div>
              </div>
            )}
          </div>

          <div style={{ height: 14 }} />

          <div className="panel">
            <h4>Quote Checker</h4>
            {quoteMatches.length === 0 ? (
              <div className="small">
                No quotes found (or run quote checker).
              </div>
            ) : (
              quoteMatches.map((q, idx) => (
                <div key={idx} style={{ marginBottom: 8 }}>
                  <div style={{ fontWeight: 600 }}>"{q.quoteText}"</div>
                  <div style={{ fontSize: 13 }}>
                    Matches:{" "}
                    {q.matches.length === 0 ? (
                      <em>none</em>
                    ) : (
                      q.matches.map((m) => (
                        <div key={m.sourceId} className="small">
                          {m.sourceId.slice(0, 6)} — {m.snippet.slice(0, 120)}
                        </div>
                      ))
                    )}
                  </div>
                </div>
              ))
            )}
          </div>

          <div style={{ height: 14 }} />
          <div className="panel small">
            Tip: This demo uses a simple backend and naive source-matching. For
            better provenance, use embeddings + similarity search.
          </div>
        </div>
      </div>
      <ToastContainer {...toastOptions} />
    </div>
  );
}
