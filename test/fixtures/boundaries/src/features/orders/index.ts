import { formatPrice } from '../../support/format';
import { listCustomers } from '../customers';

export const orders = (): string => formatPrice(listCustomers().length);
