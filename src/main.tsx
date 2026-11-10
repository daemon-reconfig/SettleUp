import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';
import { App } from './App';
import { pickUi } from './lib/server';

document.documentElement.dataset.ui = pickUi();

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
