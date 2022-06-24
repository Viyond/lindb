/*
Licensed to LinDB under one or more contributor
license agreements. See the NOTICE file distributed with
this work for additional information regarding copyright
ownership. LinDB licenses this file to you under
the Apache License, Version 2.0 (the "License"); you may
not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0
 
Unless required by applicable law or agreed to in writing,
software distributed under the License is distributed on an
"AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
KIND, either express or implied.  See the License for the
specific language governing permissions and limitations
under the License.
*/
import { IconChecklistStroked, IconDoubleChevronRight, IconGridStroked } from "@douyinfe/semi-icons";
import { Avatar, Button, Card, Col, List, Notification, Popover, Row, Select, Switch, Table, Tooltip, Typography } from "@douyinfe/semi-ui";
import { useWatchURLChange } from "@src/hooks";
import { ReplicaState } from "@src/models";
import { exec } from "@src/services";
import { getShardColor } from "@src/utils";
import * as _ from "lodash-es";
import React, { useEffect, useState } from "react";

const { Text } = Typography;

interface ReplicaViewProps {
  db: string;
  storage: string;
  liveNodes: Node[];
}

export default function ReplicaView(props: ReplicaViewProps) {
  const { db, storage, liveNodes } = props;
  const [loading, setLoading] = useState(true);
  const [replicaState, setReplicaState] = useState<any>({
    shards: [],
    nodes: [],
    families: [],
  });
  const [showShard, setShowShard] = useState(true);
  const [showLag, setShowLag] = useState(true);
  const [showTable, setShowTable] = useState(false);
  const [family, setFamily] = useState("");
  const [shard, setShard] = useState("");

  /**
   * build replica state by node.
   * node=>shard list
   * shard=>family list
   */
  const buildReplicaState = (replicaState: ReplicaState): any[] => {
    const nodes = _.keys(replicaState);
    const rs: any[] = [];
    _.forEach(nodes, (node) => {
      const logs = _.get(replicaState, node, []);
      const shards: any[] = [];
      _.forEach(logs, (log) => {
        const shardIdx = _.findIndex(shards, { shardId: log.shardId });
        const families = _.get(log, "replicators", []);
        let totalPending = 0;
        let replicators: any[] = [];
        _.forEach(families || [], (r) => {
          replicators.push(_.merge(r, log));
          totalPending += r.pending;
        });
        _.orderBy(
          replicators,
          ["replicator", "replicatorType"],
          ["desc", "desc"]
        );
        log.replicators = replicators;
        if (shardIdx < 0) {
          shards.push({
            shardId: log.shardId,
            pending: totalPending,
            channels: [log],
          });
        } else {
          const shard = shards[shardIdx];
          shard.pending += totalPending;
          shard.channels.push(log);
        }
      });
      rs.push({ node: node, shards: shards });
    });
    return rs;
  };

  /**
   * build replica state by shard id
   * shard => family list
   * family => leader->follower
   */
  const buildReplicaStateByShard = (replicaState: ReplicaState): any => {
    const rs: any[] = [];
    const nodes = _.keys(replicaState);
    const shardMap = new Map();
    const familyMap = new Map();
    _.forEach(nodes, (node) => {
      const familyList = _.get(replicaState, node, []);
      _.forEach(familyList, (family) => {
        const shardId = family.shardId;
        const familyTime = family.familyTime;
        familyMap.set(familyTime, familyTime);
        _.set(family, "sourceNode", node);

        let replicators: any[] = [];
        _.forEach(family.replicators || [], (r) => {
          replicators.push(_.merge(r, family));
        });
        _.orderBy(
          replicators,
          ["replicator", "replicatorType"],
          ["desc", "desc"]
        );

        if (shardMap.has(shardId)) {
          const shard = shardMap.get(shardId);
          const channels = _.find(shard.channels, { familyTime: familyTime });
          if (channels) {
            // add family into exist family channel
            channels.replicators.push(...replicators);
          } else {
            // add family into exist shard as new channel
            shard.channels.push({
              familyTime: familyTime,
              replicators: replicators,
            });
          }
        } else {
          const shard = {
            shardId: shardId,
            channels: [{ familyTime: familyTime, replicators: replicators }],
          };
          shardMap.set(shardId, shard);
          rs.push(shard);
        }
      });
    });
    return { shards: rs, families: Array.from(familyMap.keys()) };
  };

  const fetchReplicaState = async () => {
    try {
      setLoading(true);
      const state = await exec<ReplicaState>({
        sql: `show replication where storage='${storage}' and database='${db}'`,
      });
      const rs = buildReplicaStateByShard(state);
      const nodes = buildReplicaState(state);
      setReplicaState({
        shards: rs.shards || [],
        nodes: nodes || [],
        families: rs.families || [],
      });
    } catch (err) {
      Notification.error({
        title: "Fetch replica state error",
        content: _.get(err, "response.data", "Unknown internal error"),
        position: "top",
        theme: "light",
        duration: 5,
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchReplicaState();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storage, db]);

  useWatchURLChange(() => {
    fetchReplicaState();
  });

  const renderReplicatorState = (r: any) => {
    let color = "warning";
    switch (r.state) {
      case "Ready":
        color = "success";
        break;
      case "Init":
        color = "secondary";
        break;
      case "Failure":
        color = "danger";
        break;
    }
    return (
      <Tooltip content={r.stateErrMsg || "Ready"}>
        <div
          style={{
            borderRadius: "var(--semi-border-radius-circle)",
            width: 12,
            height: 12,
            marginTop: 4,
            backgroundColor: `var(--semi-color-${color})`,
          }}
        ></div>
      </Tooltip>
    );
  };

  const getNode = (id: string) => {
    const follower = _.find(liveNodes, {
      id: parseInt(id),
    });
    return `${_.get(follower, "hostIp", "unkonw")}:${_.get(
      follower,
      "grpcPort",
      "unkonw"
    )}`;
  };

  const renderChannel = (shard: any, shardIdx: any) => {
    return _.orderBy(shard.channels || [], ["familyTime"], ["desc"]).map(
      (channel: any, idx: any) => {
        return (
          <div
            key={idx}
            style={{
              display: "flex",
            }}
          >
            <Typography.Text
              style={{
                borderLeft: "1px solid var(--semi-color-border)",
                borderRight: "1px solid var(--semi-color-border)",
                borderBottom: "1px solid var(--semi-color-border)",
                minWidth: 180,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              {channel.familyTime}
            </Typography.Text>
            <Table
              size="small"
              pagination={false}
              dataSource={channel.replicators}
              showHeader={idx == 0 && shardIdx == 0}
              columns={[
                {
                  title: "Type",
                  dataIndex: "replicatorType",
                  width: 100,
                  render: (text, record, _index) => {
                    return (
                      <div style={{ display: "flex" }}>
                        {renderReplicatorState(record)}
                        <span style={{ marginLeft: 4 }}>{text}</span>
                      </div>
                    );
                  },
                },
                {
                  title: "Peer",
                  dataIndex: "replicator",
                  render: (_text, record, _index) => {
                    return (
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                        }}
                      >
                        <span style={{ display: "flex" }}>
                          <Avatar
                            color="amber"
                            size="extra-extra-small"
                            style={{ margin: 4 }}
                          >
                            L
                          </Avatar>
                          <span style={{ marginTop: 4 }}>
                            {getNode(record.leader)}
                          </span>
                        </span>
                        <IconDoubleChevronRight
                          style={{
                            marginLeft: 4,
                            color: "var(--semi-color-success)",
                          }}
                        />
                        <span style={{ display: "flex" }}>
                          <Avatar
                            color={
                              `${record.leader}` === record.replicator
                                ? "amber"
                                : "light-blue"
                            }
                            size="extra-extra-small"
                            style={{ margin: 4 }}
                          >
                            {`${record.leader}` === record.replicator
                              ? "L"
                              : "F"}
                          </Avatar>
                          <span style={{ marginTop: 4 }}>
                            {getNode(record.replicator)}
                          </span>
                        </span>
                      </div>
                    );
                  },
                },
                {
                  title: "Append",
                  dataIndex: "append",
                  width: 100,
                },
                {
                  title: "Consume",
                  dataIndex: "consume",
                  width: 100,
                },
                {
                  title: "Ack",
                  dataIndex: "ack",
                  width: 100,
                },
                {
                  title: "Lag",
                  dataIndex: "pending",
                  width: 100,
                },
              ]}
            />
          </div>
        );
      }
    );
  };

  const renderShards = () => {
    return (
      <Row
        type="flex"
        gutter={8}
        style={{ display: !showTable ? "block" : "none" }}
      >
        {replicaState.nodes.map((item: any) => {
          return (
            <Col span={8} key={item.node}>
              <Card bodyStyle={{ padding: 12 }}>
                <div style={{ marginBottom: 2, textAlign: "center" }}>
                  {item.node}
                </div>
                {_.get(item, "shards", []).map((shard: any) => {
                  return (
                    <Popover
                      showArrow
                      key={shard.shardId}
                      content={renderChannel(shard, 0)}
                    >
                      <Button
                        style={{
                          minWidth: 50,
                          margin: "0px 4px 4px 0px",
                          color: "var(--semi-color-text-0)",
                          backgroundColor: getShardColor(shard.shardId),
                        }}
                        size="small"
                      >
                        {showShard ? <span>S:{shard.shardId}</span> : ""}
                        {showShard && showLag ? " " : ""}
                        {showLag ? <span>L:{shard.pending}</span> : ""}
                      </Button>
                    </Popover>
                  );
                })}
              </Card>
            </Col>
          );
        })}
      </Row>
    );
  };

  const renderShardsAsTable = () => {
    let shards = _.cloneDeep(replicaState.shards);
    if (!_.isEmpty(shard)) {
      shards = _.filter(shards, function (o) {
        return `${o.shardId}` == shard;
      });
    }
    if (!_.isEmpty(family)) {
      shards = _.filter(shards, function (o) {
        o.channels = _.filter(o.channels, function (f) {
          return f.familyTime == family;
        });
        return !_.isEmpty(o.channels);
      });
    }

    shards = _.orderBy(shards, ["shardId"]);
    return (
      <List
        style={{ display: showTable ? "block" : "none" }}
        dataSource={shards}
        renderItem={(item: any, shardIdx: any) => (
          <List.Item
            style={{ display: "block", padding: "0", borderBottom: 0 }}
          >
            <div style={{ display: "flex" }}>
              <div
                style={{
                  borderLeft: "1px solid var(--semi-color-border)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  padding: "0 8px 0 8px",
                  borderBottom: "1px solid var(--semi-color-border)",
                }}
              >
                <Avatar
                  size="small"
                  style={{
                    backgroundColor: getShardColor(item.shardId),
                  }}
                >
                  {item.shardId}
                </Avatar>
              </div>
              <div
                style={{
                  width: "100%",
                  borderRight: "1px solid var(--semi-color-border)",
                }}
              >
                {renderChannel(item, shardIdx)}
              </div>
            </div>
          </List.Item>
        )}
      />
    );
  };

  return (
    <Card
      title="Replication Status"
      headerExtraContent={
        <>
          <div style={{ display: "flex", alignItems: "center" }}>
            {!showTable && (
              <>
                <Text style={{ margin: 4 }}>Shard</Text>
                <Switch
                  checked={showShard}
                  onChange={setShowShard}
                  size="small"
                />
                <Text style={{ margin: 4 }}>Lag</Text>
                <Switch checked={showLag} onChange={setShowLag} size="small" />
              </>
            )}
            {showTable && (
              <>
                <Select
                  insetLabel="Shard"
                  style={{ marginRight: 8 }}
                  showClear
                  value={shard}
                  onClear={() => {
                    setShard("");
                  }}
                  optionList={_.orderBy(
                    _.map(replicaState.shards, (shard: any) => {
                      return { label: shard.shardId, value: shard.shardId };
                    }),
                    ["label"]
                  )}
                  onChange={(value) => {
                    setShard(`${value}`);
                  }}
                />
                <Select
                  insetLabel="Family"
                  showClear
                  value={family}
                  onClear={() => {
                    setFamily("");
                  }}
                  optionList={_.orderBy(
                    _.map(replicaState.families, (f: any) => {
                      return { label: f, value: f };
                    }),
                    ["label"],
                    ["desc"]
                  )}
                  onChange={(value) => {
                    setFamily(`${value}`);
                  }}
                />
              </>
            )}
            <Button
              style={{ marginLeft: 8 }}
              icon={showTable ? <IconChecklistStroked /> : <IconGridStroked />}
              onClick={() => setShowTable(!showTable)}
            />
          </div>
        </>
      }
      headerStyle={{ padding: 12 }}
      bodyStyle={{ padding: showTable ? 0 : 12 }}
      loading={loading}
    >
      {renderShardsAsTable()}
      {renderShards()}
    </Card>
  );
}
