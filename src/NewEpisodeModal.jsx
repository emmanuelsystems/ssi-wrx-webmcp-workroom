import { useEffect, useState } from "react";
import "./NewEpisodeModal.css";

export default function NewEpisodeModal({
  open,
  onClose,
  onCreate,
}) {
  const [title, setTitle] = useState("");
  const [context, setContext] = useState("");

  useEffect(() => {
    if (!open) {
      return;
    }

    function handleKeyDown(event) {
      if (event.key === "Escape") {
        onClose();
      }
    }

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener(
        "keydown",
        handleKeyDown
      );
    };
  }, [open, onClose]);

  useEffect(() => {
    if (!open) {
      setTitle("");
      setContext("");
    }
  }, [open]);

  if (!open) {
    return null;
  }

  function handleSubmit(event) {
    event.preventDefault();

    const cleanTitle = title.trim();
    const cleanContext = context.trim();

    if (!cleanTitle) {
      return;
    }

    onCreate({
      title: cleanTitle,
      context: cleanContext,
    });

    setTitle("");
    setContext("");
  }

  return (
    <div
      className="episode-modal-overlay"
      role="presentation"
      onMouseDown={(event) => {
        if (
          event.target === event.currentTarget
        ) {
          onClose();
        }
      }}
    >
      <section
        className="episode-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="new-episode-title"
      >
        {/* HEADER */}

        <div className="episode-modal-header">
          <div>
            <div className="episode-modal-eyebrow">
              New episode
            </div>

            <h2 id="new-episode-title">
              Start something to work through
            </h2>

            <p>
              An episode is one bounded piece of
              work we want to understand, evaluate,
              validate, or reach a decision about.
            </p>
          </div>

          <button
            type="button"
            className="episode-modal-close"
            onClick={onClose}
            aria-label="Close new episode"
          >
            ×
          </button>
        </div>

        {/* FORM */}

        <form
          className="episode-modal-form"
          onSubmit={handleSubmit}
        >
          <label className="episode-field">
            <span>
              What are we working on?
              <strong>Required</strong>
            </span>

            <textarea
              autoFocus
              rows="3"
              value={title}
              onChange={(event) =>
                setTitle(event.target.value)
              }
              placeholder="e.g. Evaluate whether the weekly huddle follow-up workflow can become a reusable agentic capability."
            />
          </label>

          <label className="episode-field">
            <span>
              Add context
              <em>Optional</em>
            </span>

            <textarea
              rows="4"
              value={context}
              onChange={(event) =>
                setContext(event.target.value)
              }
              placeholder="Add any background, constraints, source material, or reason this episode matters."
            />
          </label>

          {/* EXPLANATION */}

          <div className="episode-modal-note">
            <div className="episode-note-icon">
              ↳
            </div>

            <div>
              <strong>
                The workroom will recover the rest.
              </strong>

              <p>
                Goal, workflow, governing intention,
                evidence, hidden judgment, and
                evaluation structure can emerge as
                the episode develops.
              </p>
            </div>
          </div>

          {/* ACTIONS */}

          <div className="episode-modal-actions">
            <button
              type="button"
              className="episode-button"
              onClick={onClose}
            >
              Cancel
            </button>

            <button
              type="submit"
              className="episode-button primary"
              disabled={!title.trim()}
            >
              Create episode
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}