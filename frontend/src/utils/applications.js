import axios from 'axios'
import { serverUrl } from '../config'

const opts = { withCredentials: true }

export const submitOwnerApplication = (form, image, id) => {
  const body = new FormData()
  Object.entries(form).forEach(([k, v]) => v !== '' && v != null && body.append(k, v))
  if (image) body.append('image', image)
  return axios.post(`${serverUrl}/api/applications${id ? `/${id}/resubmit` : '/owner'}`, body, opts)
}
export const submitDeliveryApplication = (form, id) =>
  axios.post(`${serverUrl}/api/applications${id ? `/${id}/resubmit` : '/delivery-partner'}`, form, opts)

export const fetchMyApplications = () => axios.get(`${serverUrl}/api/applications/mine`, opts).then((r) => r.data)
export const fetchAdminApplications = (params) => axios.get(`${serverUrl}/api/admin/applications`, { ...opts, params }).then((r) => r.data)
export const reviewApplication = (id, action, reason) =>
  axios.post(`${serverUrl}/api/admin/applications/${id}/${action}`, reason ? { reason } : {}, opts).then((r) => r.data)

export const STATUS_STYLE = {
  pending: 'bg-warning-soft text-warning',
  needs_info: 'bg-info-soft text-info',
  approved: 'bg-success-soft text-success',
  rejected: 'bg-danger-soft text-danger',
}
export const STATUS_LABEL = { pending: 'Pending review', needs_info: 'More information needed', approved: 'Approved', rejected: 'Not approved' }
export const ROLE_LABEL = { owner: 'Restaurant owner', deliveryBoy: 'Delivery partner' }
