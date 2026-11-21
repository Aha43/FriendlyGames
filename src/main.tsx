import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { applyLaunchRoute } from './shared/launch';
import './index.css';

// A Home Screen icon made while a game was open starts on Your games instead (#112).
applyLaunchRoute();

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root element');

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
