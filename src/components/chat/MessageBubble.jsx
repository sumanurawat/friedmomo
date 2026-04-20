export default function MessageBubble({ message, onPreviewClick }) {
  const isStreaming = Boolean(message?._streaming);
  const isSystem = Boolean(message?.isSystem);

  if (isSystem) {
    return (
      <article className="sb-message sb-message-system">
        <div className="sb-message-meta">
          <strong>Internal Thought Process</strong>
        </div>
        <div className="sb-message-content">
          <p><em>{message.content}</em></p>
        </div>
      </article>
    );
  }

  return (
    <article className={`sb-message sb-message-${message.role} ${isStreaming ? 'is-streaming' : ''}`}>
      <div className="sb-message-meta">
        <strong>{message.role === 'assistant' ? 'Storyboarder AI' : 'You'}</strong>
        <span>{formatTime(message.timestamp)}</span>
      </div>
      {isStreaming ? <span className="sb-message-streaming">Live draft</span> : null}
      <div className="sb-message-content">{renderMessageContent(message.content)}</div>
      {message?.scenePreview ? (
        <button
          type="button"
          className="sb-message-preview"
          onClick={() => onPreviewClick?.(message.scenePreview.sceneId)}
        >
          <div className="sb-message-preview-media">
            <img
              src={resolveLocalImage(message.scenePreview.imageUrl)}
              alt={`${message.scenePreview.title} storyboard frame`}
              loading="lazy"
            />
          </div>
          <div className="sb-message-preview-copy">
            <strong>{message.scenePreview.title}</strong>
            <span>{message.scenePreview.contextLabel || message.scenePreview.sceneNumber}</span>
            {message.scenePreview.location ? <p>{message.scenePreview.location}</p> : null}
            {message.scenePreview.storyFunction ? (
              <small>{message.scenePreview.storyFunction}</small>
            ) : message.scenePreview.mood ? (
              <small>{message.scenePreview.mood}</small>
            ) : null}
          </div>
        </button>
      ) : null}
    </article>
  );
}

function formatTime(timestamp) {
  if (!timestamp) {
    return '';
  }

  try {
    return new Date(timestamp).toLocaleTimeString();
  } catch {
    return '';
  }
}

function renderMessageContent(content) {
  const lines = String(content || '').split('\n');
  const blocks = [];
  let paragraph = [];
  let list = null;

  const flushParagraph = () => {
    if (paragraph.length === 0) {
      return;
    }
    blocks.push({
      type: 'p',
      text: paragraph.join(' ').trim(),
    });
    paragraph = [];
  };

  const flushList = () => {
    if (!list || list.items.length === 0) {
      list = null;
      return;
    }
    blocks.push(list);
    list = null;
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    const unorderedMatch = line.match(/^[-*]\s+(.+)$/);
    const orderedMatch = line.match(/^\d+[.)]\s+(.+)$/);

    if (unorderedMatch) {
      flushParagraph();
      if (!list || list.type !== 'ul') {
        flushList();
        list = { type: 'ul', items: [] };
      }
      list.items.push(unorderedMatch[1]);
      continue;
    }

    if (orderedMatch) {
      flushParagraph();
      if (!list || list.type !== 'ol') {
        flushList();
        list = { type: 'ol', items: [] };
      }
      list.items.push(orderedMatch[1]);
      continue;
    }

    if (!line) {
      flushParagraph();
      flushList();
      continue;
    }

    flushList();
    paragraph.push(line);
  }

  flushParagraph();
  flushList();

  return blocks.map((block, index) => {
    if (block.type === 'p') {
      return <p key={`p_${index}`}>{renderInline(block.text)}</p>;
    }

    if (block.type === 'ul') {
      return (
        <ul key={`ul_${index}`}>
          {block.items.map((item, itemIndex) => (
            <li key={`uli_${index}_${itemIndex}`}>{renderInline(item)}</li>
          ))}
        </ul>
      );
    }

    if (block.type === 'ol') {
      return (
        <ol key={`ol_${index}`}>
          {block.items.map((item, itemIndex) => (
            <li key={`oli_${index}_${itemIndex}`}>{renderInline(item)}</li>
          ))}
        </ol>
      );
    }

    return null;
  });
}

function renderInline(text) {
  return String(text || '')
    .split(/(\*\*[^*]+\*\*)/g)
    .map((part, index) => {
      if (part.startsWith('**') && part.endsWith('**') && part.length > 4) {
        return <strong key={`b_${index}`}>{part.slice(2, -2)}</strong>;
      }
      return <span key={`t_${index}`}>{part}</span>;
    });
}

function resolveLocalImage(imageUrl) {
  if (!imageUrl) {
    return '';
  }
  if (imageUrl.startsWith('file://')) {
    const imagesIdx = imageUrl.indexOf('/images/');
    if (imagesIdx !== -1) {
      return `sb-local://media${imageUrl.slice(imagesIdx)}`;
    }
  }
  if (
    imageUrl.startsWith('sb-local://') ||
    imageUrl.startsWith('http://') ||
    imageUrl.startsWith('https://') ||
    imageUrl.startsWith('data:')
  ) {
    return imageUrl;
  }
  return imageUrl;
}
