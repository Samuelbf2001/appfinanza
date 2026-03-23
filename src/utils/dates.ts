/** Returns ISO date strings for common reporting periods. */
export function getDateRange(period: string): { startDate: string; endDate: string } {
  const now = new Date();
  const end = new Date(now);
  end.setHours(23, 59, 59, 999);

  const start = new Date(now);
  start.setHours(0, 0, 0, 0);

  switch (period) {
    case 'today':
      break;
    case 'yesterday': {
      start.setDate(start.getDate() - 1);
      end.setDate(end.getDate() - 1);
      break;
    }
    case 'this_week': {
      const day = start.getDay();
      start.setDate(start.getDate() - day);
      break;
    }
    case 'last_week': {
      const day = start.getDay();
      start.setDate(start.getDate() - day - 7);
      end.setDate(end.getDate() - end.getDay() - 1);
      break;
    }
    case 'this_month':
      start.setDate(1);
      break;
    case 'last_month':
      start.setMonth(start.getMonth() - 1, 1);
      end.setDate(0); // last day of previous month
      break;
    case 'this_quarter': {
      const qMonth = Math.floor(start.getMonth() / 3) * 3;
      start.setMonth(qMonth, 1);
      break;
    }
    default:
      // Default to last 7 days
      start.setDate(start.getDate() - 7);
  }

  return {
    startDate: start.toISOString().split('T')[0],
    endDate: end.toISOString().split('T')[0],
  };
}
