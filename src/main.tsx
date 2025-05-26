// File: src/main.tsx
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.tsx';
import './index.css'; // Jika Anda punya file CSS global (opsional)
// Impor App.css di sini jika belum diimpor di App.tsx,
// atau pastikan sudah diimpor di dalam App.tsx
// import './App.css'; // Pastikan path-nya benar

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
