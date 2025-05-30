import React, { useState, useMemo, useCallback, useEffect } from 'react';
import { Ed25519Keypair } from '@mysten/sui.js/keypairs/ed25519';
import { getFullnodeUrl, SuiClient } from '@mysten/sui.js/client';
import { TransactionBlock } from '@mysten/sui.js/transactions';
import { decodeSuiPrivateKey } from '@mysten/sui.js/cryptography';

// Ensure Buffer is available
if (typeof window !== 'undefined') {
  window.Buffer = window.Buffer || require('buffer').Buffer;
}

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

function formatBalance(balance: bigint | null): string {
  if (balance === null) return '0.000000';
  try {
    return (Number(balance) / 1e9).toFixed(6);
  } catch (error) {
    console.error('Error formatting balance:', error);
    return '0.000000';
  }
}

function App() {
  const [keyInput, setKeyInput] = useState('');
  const [keypair, setKeypair] = useState<Ed25519Keypair | null>(null);
  const [balance, setBalance] = useState<bigint | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [recipientMode, setRecipientMode] = useState<'single' | 'multiple'>('single');
  const [recipients, setRecipients] = useState('');
  const [amount, setAmount] = useState('');

  const address = useMemo(() => keypair?.getPublicKey().toSuiAddress(), [keypair]);

  const log = useCallback((type: LogEntry['type'], message: string) => {
    setLogs((prev) => [
      { id: crypto.randomUUID(), type, message, timestamp: new Date() },
      ...prev,
    ]);
  }, []);

  const initializeKeypairFromString = (input: string): Ed25519Keypair => {
    if (input.startsWith('suiprivkey')) {
      const { secretKey } = decodeSuiPrivateKey(input);
      return Ed25519Keypair.fromSecretKey(secretKey);
    }
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
        `Saldo saat ini: ${formatBalance(totalBalance)} SUI`
      );
    } catch (error: any) {
      log('error', `Gagal menghubungkan dompet: ${error.message}`);
      console.error('Connection error details:', error);
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
        `Saldo tidak mencukupi. Dibutuhkan: ${formatBalance(totalAmountToSend)} SUI, Tersedia: ${formatBalance(balance)} SUI.`
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
        console.error(`Transfer error to ${recipientAddress}:`, error);
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
        `Saldo baru: ${formatBalance(totalNewBalance)} SUI`
      );
    } catch (error: any) {
      log('error', `Gagal memperbarui saldo: ${error.message}`);
      console.error('Balance update error:', error);
    }

    setIsLoading(false);
  };

  useEffect(() => {
    setKeypair(null);
    setBalance(null);
  }, [keyInput]);

  useEffect(() => {
    console.log('App component mounted and running.');
  }, []);

  return (
    <div className="min-h-screen bg-gradient-to-b from-gray-900 to-black py-8 px-4">
      <div className="max-w-3xl mx-auto space-y-8">
        <header className="text-center">
          <h1 className="text-5xl font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-purple-600 mb-4 font-sans">
            SUI Token Transfer Tool
          </h1>
          <p className="text-gray-400 text-lg">
            Alat untuk mengirim token SUI ke satu atau beberapa alamat di jaringan SUI.
          </p>
        </header>

        <div className="bg-gray-800/50 backdrop-blur-sm rounded-lg shadow-neon-blue p-6 border border-blue-500/20">
          <h2 className="text-2xl font-bold text-blue-400 mb-4">1. Hubungkan Dompet Anda</h2>
          <div className="space-y-4">
            <div>
              <label htmlFor="keyInput" className="block text-sm font-medium text-gray-300 mb-2">
                Private Key (suiprivkey, hex, base64) atau Mnemonic Phrase:
              </label>
              <input
                type="password"
                id="keyInput"
                value={keyInput}
                onChange={(e) => setKeyInput(e.target.value)}
                placeholder="Masukkan private key atau mnemonic Anda"
                disabled={isLoading}
                className="w-full px-4 py-2 bg-gray-700/50 border border-gray-600 rounded-md text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
              <p className="mt-2 text-sm text-gray-400">
                Contoh: suiprivkey..., 0x..., atau 12 kata mnemonic.
              </p>
            </div>
            <button
              onClick={handleConnectWallet}
              disabled={isLoading || !keyInput.trim()}
              className="w-full py-2 px-4 bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700 disabled:from-gray-600 disabled:to-gray-600 text-white rounded-md transition-all duration-300 transform hover:scale-[1.02]"
            >
              {isLoading && keypair === null ? `${SYMBOLS.processing} Menghubungkan...` : 'Hubungkan Dompet'}
            </button>
            {address && keypair && (
              <div className="mt-4 p-4 bg-gray-700/30 rounded-md border border-gray-600/50">
                <p className="text-green-400 mb-2 font-medium">Status: Terhubung</p>
                <p className="text-gray-300 break-all font-mono">Alamat: {address}</p>
                <p className="text-gray-300 font-medium">Saldo: {formatBalance(balance)} SUI</p>
              </div>
            )}
            <p className="text-yellow-400 text-sm">
              {SYMBOLS.warning} JANGAN PERNAH membagikan private key atau mnemonic Anda. Gunakan dengan risiko Anda sendiri.
            </p>
          </div>
        </div>

        {keypair && address && (
          <div className="bg-gray-800/50 backdrop-blur-sm rounded-lg shadow-neon-purple p-6 border border-purple-500/20">
            <h2 className="text-2xl font-bold text-purple-400 mb-4">2. Konfigurasi Transfer SUI</h2>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">Mode Penerima:</label>
                <div className="grid grid-cols-2 gap-4">
                  <button
                    onClick={() => setRecipientMode('single')}
                    className={`py-2 px-4 rounded-md transition-all duration-300 ${
                      recipientMode === 'single'
                        ? 'bg-gradient-to-r from-blue-600 to-purple-600 text-white shadow-neon-blue'
                        : 'bg-gray-700/50 text-gray-300 hover:bg-gray-600/50'
                    }`}
                    disabled={isLoading}
                  >
                    Penerima Tunggal
                  </button>
                  <button
                    onClick={() => setRecipientMode('multiple')}
                    className={`py-2 px-4 rounded-md transition-all duration-300 ${
                      recipientMode === 'multiple'
                        ? 'bg-gradient-to-r from-blue-600 to-purple-600 text-white shadow-neon-blue'
                        : 'bg-gray-700/50 text-gray-300 hover:bg-gray-600/50'
                    }`}
                    disabled={isLoading}
                  >
                    Beberapa Penerima
                  </button>
                </div>
              </div>

              <div>
                <label htmlFor="recipients" className="block text-sm font-medium text-gray-300 mb-2">
                  {recipientMode === 'single' ? 'Alamat Penerima Tunggal:' : 'Daftar Alamat Penerima (satu alamat per baris):'}
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
                  className="w-full px-4 py-2 bg-gray-700/50 border border-gray-600 rounded-md text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent font-mono"
                />
              </div>

              <div>
                <label htmlFor="amount" className="block text-sm font-medium text-gray-300 mb-2">
                  Jumlah SUI per Penerima:
                </label>
                <input
                  type="number"
                  id="amount"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="Contoh: 0.5"
                  disabled={isLoading}
                  className="w-full px-4 py-2 bg-gray-700/50 border border-gray-600 rounded-md text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                  step="0.000001"
                  min="0.000001"
                />
              </div>

              <button
                onClick={handleTransferSui}
                disabled={isLoading || !recipients.trim() || !amount.trim() || parseFloat(amount) <= 0}
                className="w-full py-3 px-4 bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700 disabled:from-gray-600 disabled:to-gray-600 text-white rounded-md transition-all duration-300 transform hover:scale-[1.02] text-lg font-semibold"
              >
                {isLoading ? `${SYMBOLS.processing} Mengirim SUI...` : 'Kirim SUI Sekarang'}
              </button>
            </div>
          </div>
        )}

        {logs.length > 0 && (
          <div className="bg-gray-800/50 backdrop-blur-sm rounded-lg shadow-neon-blue p-6 border border-blue-500/20">
            <h2 className="text-2xl font-bold text-blue-400 mb-4">{SYMBOLS.info} Log Aktivitas</h2>
            <div className="space-y-2 max-h-96 overflow-y-auto">
              {logs.map((logEntry) => (
                <div
                  key={logEntry.id}
                  className={`p-3 rounded-md backdrop-blur-sm ${
                    logEntry.type === 'success'
                      ? 'bg-green-900/30 text-green-400 border border-green-500/20'
                      : logEntry.type === 'error'
                      ? 'bg-red-900/30 text-red-400 border border-red-500/20'
                      : logEntry.type === 'warning'
                      ? 'bg-yellow-900/30 text-yellow-400 border border-yellow-500/20'
                      : 'bg-gray-700/30 text-gray-300 border border-gray-600/20'
                  }`}
                >
                  <div className="flex items-start gap-2">
                    <span>{SYMBOLS[logEntry.type]}</span>
                    <span className="flex-1 font-medium">{logEntry.message}</span>
                    <span className="text-xs text-gray-400">
                      {logEntry.timestamp.toLocaleTimeString()}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        <footer className="text-center space-y-4">
          <div className="flex justify-center space-x-6">
            <a
              href="https://x.com/XBerryAO"
              target="_blank"
              rel="noopener noreferrer"
              className="text-gray-400 hover:text-blue-400 transition-colors duration-300"
            >
              𝕏 Twitter
            </a>
            <a
              href="https://t.me/dlzvy"
              target="_blank"
              rel="noopener noreferrer"
              className="text-gray-400 hover:text-blue-400 transition-colors duration-300"
            >
              ✈️ Telegram
            </a>
          </div>
        </footer>
      </div>
    </div>
  );
}

export default App;