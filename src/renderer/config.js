'use strict';

(function (root) {
  const DEFAULTS = {
    v: 1,
    name: '',
    avatar: null,
    quality: {
      width: 1920,
      height: 1080,
      fps: 60,
      bitrate: 12_000_000,
      codec: 'video/H264',
    },
    camera: {
      width: 1280,
      height: 720,
      fps: 30,
      bitrate: 2_000_000,
      deviceId: null,
    },
    network: {
      advertise: true,
    },
    recentRooms: [],
  };

  function isObject(v) {
    return v !== null && typeof v === 'object' && !Array.isArray(v);
  }

  function mergeSection(defaults, incoming) {
    if (!isObject(incoming)) return { ...defaults };
    return { ...defaults, ...incoming };
  }

  function load(rawJson) {
    let parsed = {};
    if (typeof rawJson === 'string') {
      try {
        parsed = JSON.parse(rawJson);
        if (!isObject(parsed)) parsed = {};
      } catch {
        parsed = {};
      }
    }

    return {
      v: 1,
      name: typeof parsed.name === 'string' ? parsed.name : DEFAULTS.name,
      avatar: typeof parsed.avatar === 'string' ? parsed.avatar : DEFAULTS.avatar,
      quality: mergeSection(DEFAULTS.quality, parsed.quality),
      camera: mergeSection(DEFAULTS.camera, parsed.camera),
      network: mergeSection(DEFAULTS.network, parsed.network),
      recentRooms: Array.isArray(parsed.recentRooms) ? parsed.recentRooms : [],
    };
  }

  function serialize(config) {
    return JSON.stringify({ ...config, v: 1 });
  }

  function toConstraints(section) {
    return {
      width: { ideal: section.width, max: section.width },
      height: { ideal: section.height, max: section.height },
      frameRate: { ideal: section.fps, max: section.fps },
    };
  }

  function videoConstraints(quality) {
    return toConstraints(quality);
  }

  function cameraConstraints(camera) {
    return toConstraints(camera);
  }

  function addRecentRoom(config, room) {
    const withoutDup = config.recentRooms.filter((r) => r.address !== room.address);
    const recentRooms = [{ ...room, isOwn: !!room.isOwn }, ...withoutDup].slice(0, 5);
    return { ...config, recentRooms };
  }

  function removeRecentRoom(config, address) {
    return { ...config, recentRooms: config.recentRooms.filter((r) => r.address !== address) };
  }

  const api = { DEFAULTS, load, serialize, videoConstraints, cameraConstraints, addRecentRoom, removeRecentRoom };

  root.GoLive = root.GoLive || {};
  root.GoLive.config = api;

  if (typeof module !== 'undefined') module.exports = api;
})(typeof window !== 'undefined' ? window : global);
