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
 
export const applyVisibilityFilters = (instances: any[], settings: any) => {
  const safeInstances = Array.isArray(instances) ? instances : [];
  if (!settings) return safeInstances;

  return safeInstances.filter((inst) => {
    const isExternal =
      String(inst?.instanceType || "").toLowerCase() === "external";
    const source = String(inst?.externalSource || "").toLowerCase();

    if (
      isExternal &&
      source === "modrinth" &&
      settings.showModrinthInstancesInLibrary === false
    ) {
      return false;
    }

    if (
      isExternal &&
      source === "curseforge" &&
      settings.showCurseforgeInstancesInLibrary === false
    ) {
      return false;
    }

    return true;
  });
};

export const getOpenClientCreateOptions = () => ({
  instanceType: OPEN_CLIENT_INSTANCE_TYPE,
});