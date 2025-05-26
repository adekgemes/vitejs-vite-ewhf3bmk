// File: src/App.tsx
import React, { useState, useMemo, useCallback, useEffect } from 'react';
import { Ed25519Keypair } from '@mysten/sui.js/keypairs/ed25519';
import { getFullnodeUrl, SuiClient } from '@mysten/sui.js/client';
import { TransactionBlock } from '@mysten/sui.js/transactions';
import { decodeSuiPrivateKey } from '@mysten/sui.js/cryptography';
// import { Buffer } from 'buffer'; // Mungkin tidak lagi diperlukan jika vite-plugin-node-polyfills bekerja
// Namun, tidak masalah jika tetap ada.
import './App.css'; // Pastikan file CSS ini ada dan path-nya benar

// Konfigurasi RPC, menggunakan Testnet sebagai default
const SUI_RPC_URL = getFullnodeUrl('testnet');
const suiClient = new SuiClient({ url: SUI_RPC_URL });

const SYMBOLS = {
  info: 'ℹ️',
  success: '✅',
  error: '❌',
  warning: '⚠️',
  processing: '⏳',
  wallet: '💼',
};

interface LogEntry {
  id: string;
  type: 'info' | 'success' | 'error' | 'processing' | 'warning';
  message: string;
  timestamp: Date;
}

function App() {
  const [keyInput, setKeyInput] = useState('');
  const [keypair, setKeypair] = useState<Ed25519Keypair | null>(null);
  const [balance, setBalance] = useState<bigint | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [logs, setLogs] = useState<LogEntry[]>([]);

  const [recipientMode, setRecipientMode] = useState<'single' | 'multiple'>(
    'single'
  );
  const [recipients, setRecipients] = useState('');
  const [amount, setAmount] = useState('');

  const address = useMemo(
    () => keypair?.getPublicKey().toSuiAddress(),
    [keypair]
  );

  const log = useCallback((type: LogEntry['type'], message: string) => {
    setLogs((prev) => [
      { id: crypto.randomUUID(), type, message, timestamp: new Date() },
      ...prev,
    ]);
  }, []);

  const initializeKeypairFromString = (input: string): Ed25519Keypair => {
    // Coba format suiprivkey (encoded)
    if (input.startsWith('suiprivkey')) {
      const { secretKey } = decodeSuiPrivateKey(input);
      return Ed25519Keypair.fromSecretKey(secretKey);
    }
    // Coba format hex (32 byte / 64 char)
    if (
      (input.startsWith('0x') && input.length === 66) ||
      (!input.startsWith('0x') &&
        input.length === 64 &&
        /^[0-9a-fA-F]+$/.test(input))
    ) {
      const privateKeyBytes = Buffer.from(
        input.startsWith('0x') ? input.slice(2) : input,
        'hex'
      );
      if (privateKeyBytes.length === 32) {
        return Ed25519Keypair.fromSecretKey(privateKeyBytes);
      }
    }
    // Coba format base64 (32 byte / 44 char)
    if (/^[A-Za-z0-9+/=]{44}$/.test(input)) {
      const privateKeyBytes = Buffer.from(input, 'base64');
      if (privateKeyBytes.length === 32) {
        return Ed25519Keypair.fromSecretKey(privateKeyBytes);
      }
    }
    log(
      'warning',
      'Format kunci tidak dikenali secara spesifik, mencoba sebagai mnemonic phrase.'
    );
    return Ed25519Keypair.deriveKeypair(input);
  };

  const handleConnectWallet = async () => {
    if (!keyInput.trim()) {
      log('error', 'Private key atau Mnemonic tidak boleh kosong.');
      return;
    }
    setIsLoading(true);
    setLogs([]);
    log('processing', 'Menghubungkan dompet...');
    try {
      const kp = initializeKeypairFromString(keyInput.trim());
      setKeypair(kp);
      const addr = kp.getPublicKey().toSuiAddress();
      log('success', `Dompet terhubung: ${addr}`);

      log('processing', 'Memuat saldo SUI...');
      const coinBalance = await suiClient.getCoins({
        owner: addr,
        coinType: '0x2::sui::SUI',
      });
      const totalBalance = coinBalance.data.reduce(
        (sum, coin) => sum + BigInt(coin.balance),
        BigInt(0)
      );
      setBalance(totalBalance);
      log(
        'info',
        `Saldo saat ini: ${(Number(totalBalance) / 1e9).toFixed(6)} SUI`
      );
    } catch (error: any) {
      log('error', `Gagal menghubungkan dompet: ${error.message}`);
      console.error('Connection error details:', error); // Tambahkan log error detail ke konsol
      setKeypair(null);
      setBalance(null);
    } finally {
      setIsLoading(false);
    }
  };

  const handleTransferSui = async () => {
    if (!keypair || !address || balance === null) {
      log(
        'error',
        'Dompet tidak terhubung. Silakan hubungkan dompet Anda terlebih dahulu.'
      );
      return;
    }

    const recipientArray = recipients
      .split('\n')
      .map((r) => r.trim())
      .filter((r) => r.startsWith('0x') && r.length >= 60);

    const amountPerRecipient = parseFloat(amount);

    if (recipientArray.length === 0) {
      log(
        'error',
        'Tidak ada alamat penerima yang valid. Pastikan alamat dimulai dengan "0x".'
      );
      return;
    }
    if (isNaN(amountPerRecipient) || amountPerRecipient <= 0) {
      log(
        'error',
        'Jumlah SUI per penerima tidak valid atau harus lebih besar dari 0.'
      );
      return;
    }

    const totalAmountToSend =
      BigInt(Math.floor(amountPerRecipient * 1e9)) *
      BigInt(recipientArray.length);

    if (totalAmountToSend > balance) {
      log(
        'error',
        `Saldo tidak mencukupi. Dibutuhkan: ${(
          Number(totalAmountToSend) / 1e9
        ).toFixed(6)} SUI, Tersedia: ${(Number(balance) / 1e9).toFixed(6)} SUI.`
      );
      return;
    }

    setIsLoading(true);
    log(
      'info',
      `Memulai proses transfer untuk ${recipientArray.length} penerima.`
    );

    let successCount = 0;
    for (let i = 0; i < recipientArray.length; i++) {
      const recipientAddress = recipientArray[i];
      log(
        'processing',
        `[${i + 1}/${
          recipientArray.length
        }] Mengirim ${amountPerRecipient} SUI ke ${recipientAddress}...`
      );

      try {
        const txb = new TransactionBlock();
        const [coin] = txb.splitCoins(txb.gas, [
          txb.pure(amountPerRecipient * 1e9),
        ]);
        txb.transferObjects([coin], txb.pure(recipientAddress));
        txb.setGasBudget(20000000);

        const result = await suiClient.signAndExecuteTransactionBlock({
          transactionBlock: txb,
          signer: keypair,
          options: { showEffects: true, showObjectChanges: true },
          requestType: 'WaitForLocalExecution',
        });

        if (result.effects?.status.status === 'success') {
          log(
            'success',
            `Transfer ke ${recipientAddress} berhasil! Digest: ${result.digest}`
          );
          successCount++;
        } else {
          log(
            'error',
            `Transfer ke ${recipientAddress} gagal. Status: ${
              result.effects?.status.error || 'Unknown error'
            }`
          );
        }
      } catch (error: any) {
        log('error', `Gagal mengirim ke ${recipientAddress}: ${error.message}`);
        console.error(`Transfer error to ${recipientAddress}:`, error); // Tambahkan log error detail
      }
      if (i < recipientArray.length - 1) {
        await new Promise((resolve) => setTimeout(resolve, 1500));
      }
    }

    log(
      'info',
      `Proses transfer selesai. ${successCount} dari ${recipientArray.length} transfer berhasil.`
    );

    try {
      log('processing', 'Memperbarui saldo...');
      const newBalanceData = await suiClient.getCoins({
        owner: address,
        coinType: '0x2::sui::SUI',
      });
      const totalNewBalance = newBalanceData.data.reduce(
        (sum, coin) => sum + BigInt(coin.balance),
        BigInt(0)
      );
      setBalance(totalNewBalance);
      log(
        'info',
        `Saldo baru: ${(Number(totalNewBalance) / 1e9).toFixed(6)} SUI`
      );
    } catch (error: any) {
      log('error', `Gagal memperbarui saldo: ${error.message}`);
      console.error('Balance update error:', error); // Tambahkan log error detail
    }

    setIsLoading(false);
  };

  useEffect(() => {
    setKeypair(null);
    setBalance(null);
  }, [keyInput]);

  // Tambahkan console.log sederhana untuk memastikan App.tsx dijalankan
  useEffect(() => {
    console.log('App component mounted and running.');
  }, []);

  return (
    <div className="sui-transfer-app">
      <header className="app-header">
        <h1>{SYMBOLS.wallet} SUI Token Transfer Tool</h1>
        <p>
          Alat untuk mengirim token SUI ke satu atau beberapa alamat di jaringan
          SUI.
        </p>
      </header>

      <section className="card">
        <h2>1. Hubungkan Dompet Anda</h2>
        <div className="form-group">
          <label htmlFor="keyInput">
            Private Key (suiprivkey, hex, base64) atau Mnemonic Phrase:
          </label>
          <input
            type="password"
            id="keyInput"
            value={keyInput}
            onChange={(e) => setKeyInput(e.target.value)}
            placeholder="Masukkan private key atau mnemonic Anda"
            disabled={isLoading}
            className="input-field"
          />
          <small className="input-hint">
            Contoh: suiprivkey..., 0x..., atau 12 kata mnemonic.
          </small>
        </div>
        <button
          onClick={handleConnectWallet}
          disabled={isLoading || !keyInput.trim()}
          className="button primary-button"
        >
          {isLoading && keypair === null
            ? `${SYMBOLS.processing} Menghubungkan...`
            : 'Hubungkan Dompet'}
        </button>
        {address && keypair && (
          <div className="wallet-details">
            <p>
              <strong>Status:</strong>{' '}
              <span className="status-connected">Terhubung</span>
            </p>
            <p>
              <strong>Alamat:</strong>{' '}
              <span className="address-display">{address}</span>
            </p>
            <p>
              <strong>Saldo:</strong>{' '}
              <span className="balance-display">
                {(Number(balance) / 1e9).toFixed(6)} SUI
              </span>
            </p>
          </div>
        )}
        <p className="warning-text">
          {SYMBOLS.warning} JANGAN PERNAH membagikan private key atau mnemonic
          Anda. Gunakan dengan risiko Anda sendiri.
        </p>
      </section>

      {keypair && address && (
        <section className="card">
          <h2>2. Konfigurasi Transfer SUI</h2>
          <div className="form-group">
            <label>Mode Penerima:</label>
            <div className="recipient-mode-selector">
              <button
                onClick={() => setRecipientMode('single')}
                className={`button mode-button ${
                  recipientMode === 'single' ? 'active' : ''
                }`}
                disabled={isLoading}
              >
                Penerima Tunggal
              </button>
              <button
                onClick={() => setRecipientMode('multiple')}
                className={`button mode-button ${
                  recipientMode === 'multiple' ? 'active' : ''
                }`}
                disabled={isLoading}
              >
                Beberapa Penerima
              </button>
            </div>
          </div>
          <div className="form-group">
            <label htmlFor="recipients">
              {recipientMode === 'single'
                ? 'Alamat Penerima Tunggal:'
                : 'Daftar Alamat Penerima (satu alamat per baris):'}
            </label>
            <textarea
              id="recipients"
              rows={recipientMode === 'single' ? 1 : 5}
              value={recipients}
              onChange={(e) => setRecipients(e.target.value)}
              placeholder={
                recipientMode === 'single'
                  ? 'Masukkan alamat SUI (0x...)'
                  : '0xAlamatPenerima1\n0xAlamatPenerima2\n0xAlamatPenerima3'
              }
              disabled={isLoading}
              className="input-field textarea-field"
            />
          </div>
          <div className="form-group">
            <label htmlFor="amount">Jumlah SUI per Penerima:</label>
            <input
              type="number"
              id="amount"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="Contoh: 0.5"
              disabled={isLoading}
              className="input-field"
              step="0.000001"
              min="0.000001"
            />
          </div>
          <button
            onClick={handleTransferSui}
            disabled={
              isLoading ||
              !recipients.trim() ||
              !amount.trim() ||
              parseFloat(amount) <= 0
            }
            className="button primary-button large-button"
          >
            {isLoading
              ? `${SYMBOLS.processing} Mengirim SUI...`
              : 'Kirim SUI Sekarang'}
          </button>
        </section>
      )}

      {logs.length > 0 && (
        <section className="card">
          <h2>{SYMBOLS.info} Log Aktivitas</h2>
          <div className="logs-container">
            {logs.map((logEntry) => (
              <div
                key={logEntry.id}
                className={`log-entry log-${logEntry.type}`}
              >
                <span className="log-icon">{SYMBOLS[logEntry.type]}</span>
                <span className="log-message">{logEntry.message}</span>
                <span className="log-timestamp">
                  {logEntry.timestamp.toLocaleTimeString()}
                </span>
              </div>
            ))}
          </div>
        </section>
      )}
      <footer className="app-footer">
        <p>
          Dibangun dengan React & Sui.js. Selalu berhati-hati saat menangani
          private key.
        </p>
      </footer>
    </div>
  );
}

export default App;
