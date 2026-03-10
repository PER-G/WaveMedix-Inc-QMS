import './globals.css';
import AuthProvider from '../components/AuthProvider';

export const metadata = {
  title: 'Wavemedix QMS',
  description: 'Quality Management System – Wavemedix Inc',
};

export default function RootLayout({ children }) {
  return (
    <html lang="de">
      <body>
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
