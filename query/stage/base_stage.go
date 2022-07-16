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

package stage

import (
	"context"

	"github.com/lindb/lindb/internal/concurrent"
)

// baseStage represents common implements for Stage interface.
type baseStage struct {
	ctx context.Context

	stageType Type
	execPool  concurrent.Pool
}

// Type returns the type of stage.
func (stage *baseStage) Type() Type {
	return stage.stageType
}

// Execute executes the plan node, if it executes success invoke completeHandle func else invoke errHande func.
func (stage *baseStage) Execute(node PlanNode, completeHandle func(), errHandle func(err error)) {
	execFn := func() {
		// execute sub plan tree for current stage
		if err := stage.execute(node); err != nil {
			errHandle(err)
		} else {
			completeHandle()
		}
	}
	if stage.execPool == nil || stage.ctx == nil {
		execFn()
	} else {
		stage.execPool.Submit(stage.ctx, concurrent.NewTask(func() {
			execFn()
		}, errHandle))
	}
}

// execute the plan node under current stage.
func (stage *baseStage) execute(node PlanNode) error {
	if node == nil {
		return nil
	}

	// execute current plan node logic
	if err := node.Execute(); err != nil {
		return err
	}

	// if it has child node, need execute child node logic
	children := node.Children()
	for idx := range children {
		if err := stage.execute(children[idx]); err != nil {
			return err
		}
	}
	return nil
}

// Complete completes current stage.
func (stage *baseStage) Complete() {
}

// NextStages returns the next stages in the pipeline.
func (stage *baseStage) NextStages() []Stage {
	return nil
}