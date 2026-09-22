import { createRoot } from 'react-dom/client';
import '@genlayer/transaction-kit-react/styles.css';
import App from './App';
import './style.css';

createRoot(document.querySelector<HTMLDivElement>('#app')!).render(<App />);
