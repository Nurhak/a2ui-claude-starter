import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import {MarkdownContext} from '@a2ui/react';
import {injectStyles} from '@a2ui/react/styles';
import {renderMarkdown} from '@a2ui/markdown-it';
import {App} from './App';
import './styles.css';

injectStyles(); // A2UI's structural CSS for the basic catalog components

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <MarkdownContext.Provider value={renderMarkdown}>
      <App />
    </MarkdownContext.Provider>
  </StrictMode>,
);
