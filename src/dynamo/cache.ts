import clone from 'clone';

let peers: any[] = [];

interface CacheItem {
  value: any;
  date: number;
  size: number;
}

interface Cache {
  [key: string]: CacheItem;
}

/*
cache: {
  'key': {
    'value': 'value',
    'date': 'date',
    'size': 'size',
  },
}
*/
const cache: Cache = {};
let cacheSize = 0;
// 1GB
const cacheLimit = 1024 * 1024 * 1024;

const evict = (key: string) => {
  if (process.env.CACHE_ENABLED !== 'true') {
    return;
  }

  if (cache[key]) {
    cacheSize -= cache[key].size;
    delete cache[key];
  }
};

const batchEvict = (keys: string[]) => {
  if (process.env.CACHE_ENABLED !== 'true') {
    return;
  }

  keys.forEach((key) => {
    evict(key);
  });
};

const evictOldest = () => {
  let oldestKey = null;
  let oldestDate = null;
  for (const key in cache) {
    if (oldestDate === null || cache[key].date < oldestDate) {
      oldestKey = key;
      oldestDate = cache[key].date;
    }
  }

  if (oldestKey !== null) {
    evict(oldestKey);
  }
};

// Load the AWS SDK for Node.js
const AWS = require('aws-sdk');

// Set the region
AWS.config.update({
  endpoint: process.env.AWS_ENDPOINT || undefined,
  s3ForcePathStyle: !!process.env.AWS_ENDPOINT,
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  region: process.env.AWS_REGION,
});

const autoscaling = new AWS.AutoScaling();
const ec2 = new AWS.EC2();

const fetchWithTimeout = async (url: string, options: RequestInit, timeout = 5000) => {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeout);
  const response = await fetch(url, {
    ...options,
    signal: controller.signal,
  });
  clearTimeout(id);
  return response;
};

const updatePeers = async () => {
  try {
    if (process.env.AUTOSCALING_GROUP && process.env.AUTOSCALING_GROUP !== '') {
      // get all ip addresses of all nodes in auto scaling group
      const groups = await autoscaling
        .describeAutoScalingGroups({ AutoScalingGroupNames: [process.env.AUTOSCALING_GROUP] })
        .promise();

      const instances = groups.AutoScalingGroups[0].Instances;

      // get ip from ec2 instance id
      const ips = await Promise.all(
        instances.map((instance: any) =>
          ec2
            .describeInstances({
              InstanceIds: [instance.InstanceId],
            })
            .promise()
            .then((res: any) => res.Reservations[0].Instances[0].PublicIpAddress),
        ),
      );

      // make a health check to each ip address
      const healthyIps = await Promise.all(
        ips.map((ip) =>
          fetchWithTimeout(`http://${ip}:80/cache/health`, {
            method: 'GET',
          })
            .then((res) => res.json())
            .then((json) => {
              if (json.status === 'ok') {
                return ip;
              }
              return null;
            })
            .catch(() => {}),
        ),
      );

      peers = healthyIps.filter((ip) => ip !== undefined);
    }
  } catch {
    // swallow
  }
};

export const invalidate = async (key: string) => {
  if (process.env.CACHE_ENABLED !== 'true') {
    return;
  }

  try {
    if (process.env.AUTOSCALING_GROUP && process.env.AUTOSCALING_GROUP !== '') {
      // send invalidate request to each ip address
      await Promise.all(
        peers.map((ip) =>
          fetchWithTimeout(
            `http://${ip}:80/cache/invalidate`,
            {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                secret: process.env.CACHE_SECRET,
                key,
              }),
            },
            1000,
          ),
        ),
      );
    } else {
      evict(key);
    }
  } catch {
    // swallow
  }
};

export const batchInvalidate = async (keys: string[]) => {
  if (process.env.CACHE_ENABLED !== 'true') {
    return;
  }

  try {
    if (process.env.AUTOSCALING_GROUP && process.env.AUTOSCALING_GROUP !== '') {
      // send invalidate request to each ip address
      await Promise.all(
        peers.map((ip) =>
          fetchWithTimeout(
            `http://${ip}:80/cache/batchinvalidate`,
            {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                secret: process.env.CACHE_SECRET,
                keys,
              }),
            },
            1000,
          ),
        ),
      );
    } else {
      keys.forEach((key) => evict(key));
    }
  } catch {
    // swallow
  }
};

export const put = (key: string, value: any) => {
  if (process.env.CACHE_ENABLED !== 'true') {
    return;
  }

  if (process.env.CACHE_ENABLED !== 'true') {
    return;
  }

  const size = JSON.stringify(value).length;

  if (size > cacheLimit / 100) {
    return;
  }

  while (size + cacheSize > cacheLimit) {
    evictOldest();
  }

  cache[key] = {
    value: clone(value),
    date: new Date().valueOf(),
    size,
  };
  cacheSize += size;
};

export const get = (key: string): any | null => {
  if (process.env.CACHE_ENABLED !== 'true') {
    return null;
  }

  const item = cache[key];
  if (item) {
    return clone(item.value);
  }

  return null;
};

export const batchGet = (keys: string[]) => {
  return keys.map((key) => get(key));
};

export const batchPut = (dict: object) => {
  Object.entries(dict).forEach(([key, value]) => put(key, value));
};

if (process.env.AUTOSCALING_GROUP && process.env.AUTOSCALING_GROUP !== '') {
  // update peers now, and every minute
  updatePeers();
  setInterval(updatePeers, 1000 * 60);
}

module.exports = {
  put,
  get,
  evict,
  invalidate,
  updatePeers,
  batchGet,
  batchPut,
  batchInvalidate,
  batchEvict,
};
