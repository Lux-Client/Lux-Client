const OPEN_CLIENT_INSTANCE_TYPE = 'open-client';

const normalize = (value: unknown) => String(value || '').trim().toLowerCase();

export const isLegacyOpenClientInstance = (instance: any) => {
  const loader = normalize(instance?.loader);
  const name = normalize(instance?.name);
  return loader === 'fabric' && name.startsWith('client ');
};

export const isOpenClientInstance = (instance: any) => {
  return normalize(instance?.instanceType) === OPEN_CLIENT_INSTANCE_TYPE || isLegacyOpenClientInstance(instance);
};

export const isLauncherInstance = (instance: any) => !isOpenClientInstance(instance);

export const filterInstancesForMode = (instances: any, mode?: string) => {
  const safeInstances = Array.isArray(instances) ? instances : [];

  if (mode === 'client') {
    return safeInstances.filter(isOpenClientInstance);
  }

  if (mode === 'launcher') {
    return safeInstances.filter(isLauncherInstance);
  }

  return safeInstances;
};

export const getOpenClientCreateOptions = () => ({
  instanceType: OPEN_CLIENT_INSTANCE_TYPE,
});