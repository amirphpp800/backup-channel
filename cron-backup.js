
// Cron job for periodic backup check (runs every 24 hours)
import { handleUpdate, periodicBackupCheck } from './main.js';

export default {
  async scheduled(event, env, ctx) {
    console.log('Running scheduled backup check...');
    
    const token = env.TELEGRAM_BOT_TOKEN;
    const DB = env.DB;
    
    if (!token || !DB) {
      console.error('Environment not configured');
      return;
    }
    
    try {
      await periodicBackupCheck(DB, token);
      console.log('Scheduled backup check completed successfully');
    } catch (err) {
      console.error('Error in scheduled backup check:', err);
    }
  }
};
