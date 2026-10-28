import { listCustomers } from '../features/customers';

export const formatPrice = (value: number): string => `${value} ${listCustomers().length}`;
