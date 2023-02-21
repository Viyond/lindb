// Licensed to LinDB under one or more contributor
// license agreements. See the NOTICE file distributed with
// this work for additional information regarding copyright
// ownership. LinDB licenses this file to you under
// the Apache License, Version 2.0 (the "License"); you may
// not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing,
// software distributed under the License is distributed on an
// "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
// KIND, either express or implied.  See the License for the
// specific language governing permissions and limitations
// under the License.

package models

import (
	"testing"

	"github.com/BurntSushi/toml"
	"github.com/stretchr/testify/assert"
)

func TestDefaultLimits(t *testing.T) {
	l := NewDefaultLimits()
	val := l.TOML()
	cfg := &Limits{}
	_, err := toml.Decode(val, cfg)
	assert.NoError(t, err)
	assert.Equal(t, cfg, l)

	l.Metrics["system.cpu"] = 1000
	assert.NotEqual(t, l.TOML(), NewDefaultLimits().TOML())
}

func TestLimits_GetSeriesLimits(t *testing.T) {
	l := NewDefaultLimits()
	ns := "ns"
	name := "name"
	assert.Equal(t, l.MaxSeriesPerMetric, l.GetSeriesLimit(ns, name))
	l.Metrics["ns|name"] = 10
	l.Metrics["name"] = 100
	assert.Equal(t, uint32(10), l.GetSeriesLimit(ns, name))
	assert.Equal(t, uint32(100), l.GetSeriesLimit("default-ns", name))
	assert.Equal(t, l.MaxSeriesPerMetric, l.GetSeriesLimit(ns, "test"))
}
