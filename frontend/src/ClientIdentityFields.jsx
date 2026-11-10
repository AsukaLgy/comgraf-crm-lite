import { Field } from './components'

export default function ClientIdentityFields({ values, set }) {
  return (
    <>
      <Field
        label="Nombre"
        required
        value={values.name}
        onChange={(e) => set('name', e.target.value)}
      />
      <Field
        label="Empresa / razón social"
        value={values.company}
        onChange={(e) => set('company', e.target.value)}
      />
      <Field
        label="RTN opcional"
        type="text"
        inputMode="numeric"
        autoComplete="off"
        value={values.rtn}
        onChange={(e) => set('rtn', e.target.value)}
      />
    </>
  )
}
