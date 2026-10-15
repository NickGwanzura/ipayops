import Image from 'next/image';
import { LockKeyhole, Wrench } from 'lucide-react';
import styles from './maintenance.module.css';

export default function MaintenancePage() {
  return (
    <main className={styles.page}>
      <div className={styles.card}>
        <Image src="/iPaytechLogo.jpg" alt="iPayTech" width={150} height={63} priority className={styles.logo} />
        <div className={styles.animation} aria-hidden="true">
          <span className={styles.orbit} />
          <LockKeyhole size={48} strokeWidth={1.5} />
          <span className={styles.tool}><Wrench size={21} /></span>
        </div>
        <span className={styles.status}><span /> Maintenance in progress</span>
        <h1>We’ll be back soon.</h1>
        <p>iPayTech Operations is temporarily unavailable while we carry out maintenance. Thank you for your patience.</p>
        <a href="" className={styles.button}>Check again</a>
        <small>Please check back in a little while.</small>
      </div>
      <footer>iPayTech Operations · Under maintenance</footer>
    </main>
  );
}
